/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import { createVisionCache } from '../src/cache/vision-cache.ts'

const IMAGE = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

function ok(text = 'seen'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })
}

function fail(status: number, text = 'failed'): Response {
  return new Response(text, { status })
}

function makeAdapter(options = {}) {
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: (provider) => ({
      provider,
      baseURL: provider === 'p' ? 'https://custom.example/v1' : `https://${provider}.example/v1`,
      model: 'vision-model',
      apiStyle: 'chat-completions',
      maxOutputTokens: 256,
      timeoutMs: 10_000,
    }),
    resolveApiKey: async () => '',
    retry: { maxRetries: 0 },
    ...options,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('provider-neutral execution trace', () => {
  it('counts one wire call and serialized payload bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    const result = await makeAdapter().call('p', { prompt: 'describe', images: [IMAGE] })
    expect(result.trace).toMatchObject({
      providerCalls: 1,
      cacheHits: 0,
      retries: 0,
      modelFallbacks: 0,
      providerFallbacks: 0,
      splits: 0,
    })
    expect(result.trace?.payloadBytes).toBeGreaterThan(IMAGE.bytes.length)
  })

  it('reports a cache hit as zero wire calls on the cached operation', async () => {
    const fetchMock = vi.fn(async () => ok('cached'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = makeAdapter({ cache: createVisionCache() })
    await adapter.call('p', { prompt: 'same', images: [IMAGE] })
    const second = await adapter.call('p', { prompt: 'same', images: [IMAGE] })
    expect(second.trace).toMatchObject({ providerCalls: 0, payloadBytes: 0, cacheHits: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('counts retries separately from total provider calls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(500))
      .mockResolvedValueOnce(ok('after retry'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = makeAdapter({
      retry: { maxRetries: 1, backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } },
    })
    const promise = adapter.call('p', { prompt: 'retry', images: [IMAGE] })
    await vi.advanceTimersByTimeAsync(2)
    const result = await promise
    expect(result.trace).toMatchObject({ providerCalls: 2, retries: 1 })
  })

  it('counts model and provider fallback attempts', async () => {
    const modelFetch = vi.fn()
      .mockResolvedValueOnce(fail(400, 'model does not support image input'))
      .mockResolvedValueOnce(ok('model fallback'))
    vi.stubGlobal('fetch', modelFetch)
    const modelAdapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: () => ({
        provider: 'p', baseURL: 'https://opencode.ai/zen/go/v1', model: 'broken',
        apiStyle: 'chat-completions', maxOutputTokens: 256, timeoutMs: 10_000,
      }),
      resolveApiKey: async () => '',
      retry: { maxRetries: 0 },
    })
    const modelResult = await modelAdapter.call('p', { prompt: 'see', images: [IMAGE] })
    expect(modelResult.trace).toMatchObject({ providerCalls: 2, modelFallbacks: 1, providerFallbacks: 0 })

    vi.unstubAllGlobals()
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok('provider fallback'))
    vi.stubGlobal('fetch', providerFetch)
    const providerAdapter = makeAdapter({ resolveProviderFallbacks: () => ['backup'] })
    const providerResult = await providerAdapter.call('p', { prompt: 'see', images: [IMAGE] })
    expect(providerResult.provider).toBe('backup')
    expect(providerResult.trace).toMatchObject({ providerCalls: 2, providerFallbacks: 1 })
  })

  it('counts adaptive split events and all resulting wire calls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(413, 'too large'))
      .mockResolvedValueOnce(ok('left'))
      .mockResolvedValueOnce(ok('right'))
    vi.stubGlobal('fetch', fetchMock)
    const images = [IMAGE, { ...IMAGE }, { ...IMAGE }, { ...IMAGE }]
    const result = await makeAdapter().call('p', { prompt: 'compare', images })
    expect(result.trace).toMatchObject({ providerCalls: 3, splits: 1 })
  })

  it('keeps trace counters on a terminal provider error', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => fail(500)))
    const adapter = makeAdapter({
      retry: { maxRetries: 1, backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } },
    })
    let caught: unknown
    const promise = adapter.call('p', { prompt: 'fail', images: [IMAGE], provider: 'p' }).catch(error => { caught = error })
    await vi.advanceTimersByTimeAsync(3)
    await promise
    expect(caught).toMatchObject({
      trace: expect.objectContaining({ providerCalls: 2, retries: 1 }),
    })
  })
})
