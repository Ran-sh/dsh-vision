/**
 * Real-HTTP integration tests: a local `node:http` server stands in for the
 * vision provider, so the adapter exercises actual URL joins, headers, bodies,
 * status codes, abort, and response parsing — not just a mocked `fetch`
 * function (task: "don't only mock fetch"). Also drives the settings card's
 * host RPC (test-connection and model-list) through the real adapter path.
 * @vitest-environment node
 */

import { createServer, type Server, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import type { OpenAICompatibleVisionOptions } from '../src/adapters/openai-compatible/types.ts'
import { runConnectionTest, listEndpointModels } from '../src/runtime/vision-rpc.ts'

/** One recorded request the fake provider received. */
interface SeenRequest {
  method: string
  url: string
  authorization: string | undefined
  body: unknown
}

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers) {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  servers.length = 0
})

/** Boot a fake vision endpoint; `handler` answers each request. */
async function fakeEndpoint(
  handler: (req: IncomingMessage, body: unknown) => { status: number; json: unknown },
): Promise<{ baseURL: string; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw.length > 0 ? JSON.parse(raw) : undefined
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers['authorization'],
        body,
      })
      const outcome = handler(req, body)
      res.writeHead(outcome.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(outcome.json))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  servers.push(server)
  const port = (server.address() as AddressInfo).port
  return { baseURL: `http://127.0.0.1:${port}/v1`, seen }
}

/** An adapter with fixed endpoint facts pointing at the fake server. */
function adapterFor(baseURL: string, overrides: Partial<OpenAICompatibleVisionOptions> = {}): OpenAICompatibleVisionAdapter {
  const options: OpenAICompatibleVisionOptions = {
    provider: 'fake',
    baseURL,
    model: 'm',
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 10_000,
    ...overrides,
  }
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: () => options,
    resolveApiKey: async () => 'sk-test',
    retry: { maxRetries: 0 },
  })
}

const IMAGE = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

describe('OpenAICompatibleVisionAdapter over a real HTTP server', () => {
  it('POSTs to {baseURL}/chat/completions with the bearer header and parsed JSON body', async () => {
    const { baseURL, seen } = await fakeEndpoint(() => ({
      status: 200,
      json: { choices: [{ message: { content: 'hello over http' } }] },
    }))
    const adapter = adapterFor(baseURL)
    const result = await adapter.call('fake', { prompt: 'p', images: [IMAGE] })
    expect(result.text).toBe('hello over http')
    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('POST')
    expect(seen[0].url).toBe('/v1/chat/completions')
    expect(seen[0].authorization).toBe('Bearer sk-test')
    const body = seen[0].body as { model: string; messages: unknown[] }
    expect(body.model).toBe('m')
    expect(JSON.stringify(body.messages)).toContain('data:image/png;base64')
  })

  it('maps a real HTTP 401 to AUTH_FAILED (no retry)', async () => {
    const { baseURL, seen } = await fakeEndpoint(() => ({
      status: 401,
      json: { error: { message: 'bad key' } },
    }))
    const adapter = adapterFor(baseURL)
    await expect(adapter.call('fake', { prompt: 'p', images: [IMAGE] }))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: 'AUTH_FAILED', status: 401 }) })
    expect(seen).toHaveLength(1)
  })

  it('maps a real HTTP 429 to RATE_LIMITED after retry exhaustion', async () => {
    const { baseURL, seen } = await fakeEndpoint(() => ({
      status: 429,
      json: { error: { message: 'slow down' } },
    }))
    const adapter = adapterFor(baseURL)
    await expect(adapter.call('fake', { prompt: 'p', images: [IMAGE] }))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: 'RATE_LIMITED' }) })
    expect(seen.length).toBeGreaterThanOrEqual(1)
  })

  it('serializes the responses wire style to {baseURL}/responses', async () => {
    const { baseURL, seen } = await fakeEndpoint(() => ({
      status: 200,
      json: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'responses over http' }] }] },
    }))
    const adapter = adapterFor(baseURL, { apiStyle: 'responses' })
    const result = await adapter.call('fake', { prompt: 'p', images: [IMAGE] })
    expect(result.text).toBe('responses over http')
    expect(seen[0].url).toBe('/v1/responses')
    const body = seen[0].body as { input: Array<{ content: unknown[] }> }
    expect(Array.isArray(body.input[0].content)).toBe(true)
  })

  it('cancels a slow provider response via AbortSignal', async () => {
    const server = createServer((_req, res) => {
      // Never answer: the caller aborts first.
      setTimeout(() => {
        try {
          res.destroy()
        } catch {
          // Already gone.
        }
      }, 5_000)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    servers.push(server)
    const port = (server.address() as AddressInfo).port
    const adapter = adapterFor(`http://127.0.0.1:${port}/v1`)
    const controller = new AbortController()
    const promise = adapter.call('fake', { prompt: 'p', images: [IMAGE], signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })
})

describe('settings card host RPC over a real HTTP server', () => {
  it('runConnectionTest succeeds and echoes the model answer', async () => {
    const { baseURL, seen } = await fakeEndpoint(() => ({
      status: 200,
      json: { choices: [{ message: { content: 'OK' } }] },
    }))
    const ctx = new Context()
    const outcome = await runConnectionTest(ctx, { baseURL, model: 'm', apiKey: 'sk-test' })
    expect(outcome).toEqual({ ok: true, text: 'OK' })
    expect(seen[0].authorization).toBe('Bearer sk-test')
    // The draft key travels host-side only: it appears in the wire request,
    // never in the returned outcome.
    expect(JSON.stringify(outcome)).not.toContain('sk-test')
  })

  it('runConnectionTest reports a readable failure for an auth rejection', async () => {
    const { baseURL } = await fakeEndpoint(() => ({
      status: 401,
      json: { error: { message: 'nope' } },
    }))
    const ctx = new Context()
    const outcome = await runConnectionTest(ctx, { baseURL, model: 'm', apiKey: 'sk-bad' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).not.toContain('sk-bad')
      expect(outcome.message.length).toBeGreaterThan(0)
    }
  })

  it('listEndpointModels reads /models through the host', async () => {
    const { baseURL, seen } = await fakeEndpoint(() => ({
      status: 200,
      json: { data: [{ id: 'm1' }, { id: 'm2' }] },
    }))
    const ctx = new Context()
    const outcome = await listEndpointModels(ctx, { baseURL, apiKey: 'sk-test' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.source).toBe('endpoint')
      expect(outcome.models).toContain('m1')
      expect(outcome.models).toContain('m2')
    }
    expect(seen[0].url).toBe('/v1/models')
    expect(seen[0].method).toBe('GET')
  })
})
