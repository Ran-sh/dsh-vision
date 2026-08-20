/**
 * HTTP envelope tests for the /image-mind RPC routes: the host routes must
 * wrap runConnectionTest / listEndpointModels into the exact JSON the browser
 * contract expects (ok/value with text+visualVerified / models+source, and
 * ok/error with a readable message). A fake WebServer captures the registered
 * prefix handler and fake hooks answer deterministic RPC results, so the
 * envelope logic is verified without any real provider call.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { registerAttachRoute } from '../src/attachments/routes.ts'

/** A fake host WebServer that only records the registered prefix route. */
function fakeWebServer(): { register: (route: unknown) => void; route?: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } } {
  const box: { route?: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } } = {}
  return {
    register(route: unknown) {
      box.route = route as { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }
    },
    get route() { return box.route },
  }
}

/** Build a minimal trusted loopback request (streamable body). */
function request(method: string, url: string, body?: unknown, origin?: string): IncomingMessage {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const req = {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      ...origin === undefined ? {} : { origin },
      ...payload === undefined ? {} : { 'content-type': 'application/json' },
    } as Record<string, string>,
    socket: { remoteAddress: '127.0.0.1' },
    // readJsonBody consumes the request as an async iterable of Buffers.
    [Symbol.asyncIterator]: async function* () {
      if (payload !== undefined) yield payload
    },
  } as unknown as IncomingMessage
  return req
}

/** Capture what the handler writes to the response. */
function capture(): { res: ServerResponse; result: () => { status: number; headers: Record<string, string>; payload: string; body: unknown } } {
  let status = 0
  let headers: Record<string, string> = {}
  let payload = ''
  const res = {
    writeHead(code: number, nextHeaders?: Record<string, string>) {
      status = code
      headers = nextHeaders ?? {}
    },
    end(text: string) { payload = text },
  } as unknown as ServerResponse
  return {
    res,
    result: () => ({ status, headers, payload, body: JSON.parse(payload) as unknown }),
  }
}

const hooks = {
  readMaxBytes: () => 10 * 1024 * 1024,
  readConfigView: async () => ({}),
  writeConfigView: async () => ({ ok: true }),
  runConnectionTest: async () => ({ ok: true as const, text: 'blue', provider: 'test', model: 'mimo-v2.5', latencyMs: 12, visualVerified: true as const }),
  listEndpointModels: async () => ({ ok: true as const, models: ['mimo-v2.5', 'kimi-k3'], source: 'endpoint' as const }),
  catalog: () => [{ id: 'opencode-go' }],
}

function makeCtx(web: ReturnType<typeof fakeWebServer>): Context {
  return { get: (key: string) => (key === 'webServer' ? web : undefined) } as unknown as Context
}

describe('/image-mind RPC envelope', () => {
  it('POST /test wraps a successful visual test into {ok,value:{text,visualVerified,...}}', async () => {
    const web = fakeWebServer()
    registerAttachRoute(makeCtx(web), hooks)
    expect(web.route).toBeDefined()
    const { res, result } = capture()
    await web.route!.handler(request('POST', '/image-mind/test', { baseURL: 'http://x', model: 'm' }), res)
    const out = result()
    expect(out.status).toBe(200)
    expect(out.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(out.payload.trimStart().startsWith('<')).toBe(false)
    expect(out.body).toEqual({ ok: true, value: { text: 'blue', provider: 'test', model: 'mimo-v2.5', latencyMs: 12, visualVerified: true } })
  })

  it('POST /test maps a failed visual challenge to {ok:false,error:{message}}', async () => {
    const web = fakeWebServer()
    registerAttachRoute(makeCtx(web), {
      ...hooks,
      runConnectionTest: async () => ({ ok: false as const, message: '端点可连接，但视觉验证失败（模型回复 "x"）。', visualFailed: true as const }),
    })
    const { res, result } = capture()
    await web.route!.handler(request('POST', '/image-mind/test', { baseURL: 'http://x', model: 'm' }), res)
    const out = result()
    expect(out.body.ok).toBe(false)
    expect(out.body.error.code).toBe('visual')
    expect(out.body.error.message).toContain('视觉验证失败')
  })

  it('POST /models wraps the model list into {ok,value:{models,source}}', async () => {
    const web = fakeWebServer()
    registerAttachRoute(makeCtx(web), hooks)
    const { res, result } = capture()
    await web.route!.handler(request('POST', '/image-mind/models', { baseURL: 'http://x' }), res)
    const out = result()
    expect(out.status).toBe(200)
    expect(out.body).toEqual({ ok: true, value: { models: ['mimo-v2.5', 'kimi-k3'], source: 'endpoint' } })
  })

  it('GET /catalog serves the provider directory', async () => {
    const web = fakeWebServer()
    registerAttachRoute(makeCtx(web), hooks)
    const { res, result } = capture()
    await web.route!.handler(request('GET', '/image-mind/catalog'), res)
    expect((result().body as { value: { catalog: unknown } }).value.catalog).toEqual([{ id: 'opencode-go' }])
  })

  it('returns an intentional JSON 405 for an unsupported method', async () => {
    const web = fakeWebServer()
    registerAttachRoute(makeCtx(web), hooks)
    const { res, result } = capture()
    await web.route!.handler(request('PUT', '/image-mind/test'), res)
    const out = result()
    expect(out.status).toBe(405)
    expect(out.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(out.body).toEqual({ ok: false, error: { code: 'internal', message: 'only GET and POST are allowed' } })
  })

  it('keeps the local-origin security gate on supported RPC routes', async () => {
    const runConnectionTest = vi.fn(hooks.runConnectionTest)
    const web = fakeWebServer()
    registerAttachRoute(makeCtx(web), { ...hooks, runConnectionTest })
    const { res, result } = capture()
    await web.route!.handler(request('POST', '/image-mind/test', {}, 'https://evil.example'), res)
    const out = result()
    expect(out.status).toBe(403)
    expect(out.body).toEqual({ ok: false, error: { code: 'rejected', message: 'untrusted origin' } })
    expect(runConnectionTest).not.toHaveBeenCalled()
  })
})
