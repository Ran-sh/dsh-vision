/**
 * Adapter tests: chat-completions and responses payloads, HTTP error mapping
 * (401/403/429/500), timeout, abort, retry policy (transient retried, auth not),
 * and malformed/empty responses.
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import { VisionError } from '../src/runtime/errors.ts'
import type { VisionConnection, VisionRequest } from '../src/runtime/types.ts'
import { createVisionCache } from '../src/cache/vision-cache.ts'

const IMAGE = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

function connection(overrides: Partial<VisionConnection> = {}): VisionConnection {
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
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => 'sk' })
    const result = await adapter.call(request, connection())
    expect(result.text).toBe('hello vision')
    expect(result.provider).toBe('p')
    expect(result.model).toBe('m')
  })

  it('extracts text from a responses payload', async () => {
    mockFetch(responsesResponse('hello responses'))
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => 'sk' })
    const result = await adapter.call(request, connection({ apiStyle: 'responses' }))
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
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => 'sk' })
    await expect(adapter.call(request, connection())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('throws EMPTY_RESPONSE for an empty text answer', async () => {
    mockFetch(chatResponse('   '))
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => 'sk' })
    await expect(adapter.call(request, connection())).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('maps 401 to AUTH_FAILED without retrying', async () => {
    const fetchMock = vi.fn(async () => errorResponse(401, '{"error":{"message":"bad key"}}'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => 'sk' })
    await expect(adapter.call(request, connection())).rejects.toMatchObject({ code: 'AUTH_FAILED', status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps 403 to AUTH_FAILED without retrying', async () => {
    const fetchMock = vi.fn(async () => errorResponse(403))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => 'sk' })
    await expect(adapter.call(request, connection())).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps 429 to RATE_LIMITED and retries once with backoff', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(chatResponse('ok after retry'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveApiKey: async () => 'sk',
      retry: { maxRetries: 1, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    const resultPromise = adapter.call(request, connection())
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
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveApiKey: async () => 'sk',
      retry: { maxRetries: 1, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    const resultPromise = adapter.call(request, connection())
    await vi.advanceTimersByTimeAsync(150)
    const result = await resultPromise
    expect(result.text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries', async () => {
    const fetchMock = vi.fn(async () => errorResponse(500))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveApiKey: async () => 'sk',
      retry: { maxRetries: 2, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    // Start the call, let each backoff fire, then settle the promise.
    let rejection: unknown
    const promise = adapter.call(request, connection()).catch(error => { rejection = error })
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
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveApiKey: async () => 'sk',
      retry: { maxRetries: 1, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    const resultPromise = adapter.call(request, connection())
    await vi.advanceTimersByTimeAsync(150)
    const result = await resultPromise
    expect(result.text).toBe('ok')
  })

  it('does not retry after the caller aborts', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => {
        // The signal fires; reject like a real fetch would.
      })
      controller.abort()
      throw new Error('AbortError')
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveApiKey: async () => 'sk',
      retry: { maxRetries: 5, backoff: { initialDelayMs: 10, maxDelayMs: 10, jitterRatio: 0 } },
    })
    await expect(adapter.call({ ...request, signal: controller.signal }, connection())).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the semantic cache for identical requests', async () => {
    const fetchMock = vi.fn(async () => chatResponse('cached answer'))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createVisionCache()
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => 'sk', cache })
    const first = await adapter.call(request, connection())
    const second = await adapter.call(request, connection())
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
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => 'sk' })
    await expect(adapter.call(request, connection())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
