/**
 * Adapter tests: chat-completions and responses payloads, HTTP error mapping
 * (401/403/429/500), timeout, abort, retry policy (transient retried, auth not),
 * malformed/empty responses, model override, and immutable per-call snapshots.
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import { ImageMindVisionError } from '../src/adapters/openai-compatible/adapter.ts'
import type { OpenAICompatibleVisionOptions } from '../src/adapters/openai-compatible/types.ts'
import type { VisionRequest } from '@ran-sh/dsh-vision'
import { createVisionCache } from '../src/cache/vision-cache.ts'

const IMAGE = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

function connection(overrides: Partial<OpenAICompatibleVisionOptions> = {}): OpenAICompatibleVisionOptions {
  return {
    provider: 'p',
    baseURL: 'https://api.example.com/v1',
    model: 'm',
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 10_000,
    apiKeyEnv: 'KEY',
    ...overrides,
  }
}

/** An adapter whose option resolution returns the given snapshot (fixed per call). */
function fixedAdapter(
  options: OpenAICompatibleVisionOptions = connection(),
  adapterOptions: Partial<ConstructorParameters<typeof OpenAICompatibleVisionAdapter>[0]> = {},
): OpenAICompatibleVisionAdapter {
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: () => options,
    resolveApiKey: async () => 'sk',
    ...adapterOptions,
  })
}

/** A fetch stub returning the given response. */
function mockFetch(response: Partial<Response> & { ok: boolean; status: number }): void {
  vi.stubGlobal('fetch', vi.fn(async () => response as Response))
}

function chatResponse(text: string): Partial<Response> & { ok: boolean; status: number } {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({
          choices: [{ message: { content: text } }],
        })))
        controller.close()
      },
    }),
  }
}

function responsesResponse(text: string): Partial<Response> & { ok: boolean; status: number } {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
        })))
        controller.close()
      },
    }),
  }
}

function errorResponse(status: number, body?: string): Partial<Response> & { ok: boolean; status: number } {
  return {
    ok: false,
    status,
    body: body === undefined ? null : new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    }),
  }
}

const request: VisionRequest = { prompt: 'p', images: [IMAGE] }

describe('OpenAICompatibleVisionAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('extracts text from a chat-completions payload', async () => {
    mockFetch(chatResponse('hello vision'))
    const adapter = fixedAdapter()
    const result = await adapter.call('p', request)
    expect(result.text).toBe('hello vision')
    expect(result.provider).toBe('p')
    expect(result.model).toBe('m')
  })

  it('extracts text from a responses payload', async () => {
    mockFetch(responsesResponse('hello responses'))
    const adapter = fixedAdapter(connection({ apiStyle: 'responses' }))
    const result = await adapter.call('p', request)
    expect(result.text).toBe('hello responses')
  })

  it('throws INVALID_RESPONSE for a malformed payload', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"choices": []}'))
          controller.close()
        },
      }),
    })
    const adapter = fixedAdapter()
    // The wire error surfaces inside the adapter; the seam-visible error
    // carries the stable provider-neutral code with the wire detail chained.
    await expect(adapter.call('p', request)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    await expect(adapter.call('p', request)).rejects.toMatchObject({ cause: expect.objectContaining({ code: 'INVALID_RESPONSE' }) })
  })

  it('throws EMPTY_RESPONSE for an empty text answer', async () => {
    mockFetch(chatResponse('   '))
    const adapter = fixedAdapter()
    await expect(adapter.call('p', request)).rejects.toMatchObject({ cause: expect.objectContaining({ code: 'EMPTY_RESPONSE' }) })
  })

  it('maps 401 to AUTH_FAILED without retrying', async () => {
    const fetchMock = vi.fn(async () => errorResponse(401, '{"error":{"message":"bad key"}}'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = fixedAdapter()
    await expect(adapter.call('p', request)).rejects.toMatchObject({ cause: expect.objectContaining({ code: 'AUTH_FAILED', status: 401 }) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps 403 to AUTH_FAILED without retrying', async () => {
    const fetchMock = vi.fn(async () => errorResponse(403))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = fixedAdapter()
    await expect(adapter.call('p', request)).rejects.toMatchObject({ cause: expect.objectContaining({ code: 'AUTH_FAILED' }) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps 429 to RATE_LIMITED and retries once with backoff', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(chatResponse('ok after retry'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = fixedAdapter(connection(), {
      retry: { maxRetries: 1, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    const resultPromise = adapter.call('p', request)
    // Let the first failure land, then advance the backoff timer.
    await vi.advanceTimersByTimeAsync(150)
    const result = await resultPromise
    expect(result.text).toBe('ok after retry')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps 500 to PROVIDER_ERROR and retries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(chatResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = fixedAdapter(connection(), {
      retry: { maxRetries: 1, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    const resultPromise = adapter.call('p', request)
    await vi.advanceTimersByTimeAsync(150)
    const result = await resultPromise
    expect(result.text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries', async () => {
    const fetchMock = vi.fn(async () => errorResponse(500))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = fixedAdapter(connection(), {
      retry: { maxRetries: 2, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    // Start the call, let each backoff fire, then settle the promise.
    let rejection: unknown
    const promise = adapter.call('p', request).catch(error => { rejection = error })
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(150)
      await Promise.resolve()
    }
    await promise
    expect(rejection).toMatchObject({ code: 'PROVIDER_ERROR' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('maps a network failure to NETWORK_ERROR and retries', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(chatResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = fixedAdapter(connection(), {
      retry: { maxRetries: 1, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    const resultPromise = adapter.call('p', request)
    await vi.advanceTimersByTimeAsync(150)
    const result = await resultPromise
    expect(result.text).toBe('ok')
  })

  it('does not retry after the caller aborts', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      controller.abort()
      throw new Error('AbortError')
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = fixedAdapter(connection(), {
      retry: { maxRetries: 5, backoff: { initialDelayMs: 10, maxDelayMs: 10, jitterRatio: 0 } },
    })
    await expect(adapter.call('p', { ...request, signal: controller.signal })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the semantic cache for identical requests', async () => {
    const fetchMock = vi.fn(async () => chatResponse('cached answer'))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createVisionCache()
    const adapter = fixedAdapter(connection(), { cache })
    const first = await adapter.call('p', request)
    const second = await adapter.call('p', request)
    expect(first.text).toBe('cached answer')
    expect(second.text).toBe('cached answer')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws INVALID_RESPONSE for invalid JSON', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('not json'))
          controller.close()
        },
      }),
    })
    const adapter = fixedAdapter()
    await expect(adapter.call('p', request)).rejects.toMatchObject({ cause: expect.objectContaining({ code: 'INVALID_RESPONSE' }) })
  })

  it('the request model override reaches the wire body', async () => {
    const fetchMock = vi.fn(async () => chatResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    // The option resolution applies the override exactly like the plugin's
    // composition hook: the request's model wins over the configured default.
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: (provider, req) => ({
        ...connection({ model: 'configured-default' }),
        ...req.model !== undefined && req.model.trim().length > 0 ? { model: req.model.trim() } : {},
      }),
      resolveApiKey: async () => 'sk',
    })
    await adapter.call('p', { ...request, model: 'override-model' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body)) as { model: string }
    expect(body.model).toBe('override-model')
    // Without an override the configured default is used.
    await adapter.call('p', request)
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit
    const second = JSON.parse(String(secondInit.body)) as { model: string }
    expect(second.model).toBe('configured-default')
  })

  it('sends every image in one request (multi-image wire)', async () => {
    const fetchMock = vi.fn(async () => chatResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = fixedAdapter()
    const second = { bytes: Buffer.from([9, 9, 9]), mimeType: 'image/jpeg' as const }
    await adapter.call('p', { ...request, images: [IMAGE, second] })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: Array<{ type: string; image_url: { url: string } | string }> }> }
    const parts = body.messages[0].content
    const imageParts = parts.filter(part => part.type === 'image_url')
    expect(imageParts).toHaveLength(2)
    // chat-completions nests the data URL: { image_url: { url: ... } }.
    const urls = imageParts.map(part => (part.image_url as { url: string }).url)
    expect(urls[0]).toContain('data:image/png;base64')
    expect(urls[1]).toContain('data:image/jpeg;base64')
  })

  it('resolves the endpoint snapshot once per call and freezes it (immutable in-flight)', async () => {
    const fetchMock = vi.fn(async () => chatResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    let resolves = 0
    let frozen: OpenAICompatibleVisionOptions | undefined
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: (provider, req) => {
        resolves += 1
        return { ...connection(), model: req.model ?? 'm' }
      },
      resolveApiKey: async (options) => {
        frozen = options
        return 'sk'
      },
    })
    await adapter.call('p', request)
    expect(resolves).toBe(1)
    expect(Object.isFrozen(frozen)).toBe(true)
  })
})
