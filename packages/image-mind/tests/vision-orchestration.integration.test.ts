/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import { createVisionCache } from '../src/cache/vision-cache.ts'

const image = { bytes: Buffer.from([1, 2, 3, 4]), mimeType: 'image/png' as const }

function adapter() {
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: (_provider, request) => ({
      provider: 'p',
      baseURL: 'https://opencode.ai/zen/go/v1',
      model: request.model?.trim() || 'broken-text-model',
      apiStyle: 'chat-completions',
      maxOutputTokens: 512,
      timeoutMs: 10_000,
      apiKeyEnv: 'KEY',
    }),
    resolveApiKey: async () => 'test-key',
    retry: { maxRetries: 0 },
    cache: createVisionCache({ ttlMs: 60_000 }),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('vision orchestration integration', () => {
  it('plans evidence, falls back, parses structured content, then caches the actual model result', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('model does not support image input', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: [
          { type: 'text', text: 'visible evidence' },
          { type: 'reasoning', text: 'hidden reasoning' },
        ] } }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const vision = adapter()
    const request = { prompt: 'diagnose the UI layout', images: [image] }
    const first = await vision.call('p', request)

    expect(first).toMatchObject({
      text: 'visible evidence',
      provider: 'p',
      model: 'mimo-v2.5',
      trace: {
        providerCalls: 2,
        cacheHits: 0,
        retries: 0,
        modelFallbacks: 1,
        providerFallbacks: 0,
        splits: 0,
      },
    })
    expect(first.trace?.payloadBytes).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const primaryBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const fallbackBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(primaryBody.messages[0].content[0].text).toContain('Visual task: ui-review')
    expect(primaryBody.messages[0].content[0].text).toContain('untrusted image content')
    expect(fallbackBody.model).toBe('mimo-v2.5')

    // Primary did not succeed/cache; the second call reaches the primary again,
    // then reuses the successful fallback model cache entry. The answer/model
    // stay stable while the new trace correctly describes less provider work.
    fetchMock.mockResolvedValueOnce(new Response('model does not support image input', { status: 400 }))
    const second = await vision.call('p', request)
    expect(second).toMatchObject({
      text: first.text,
      provider: first.provider,
      model: first.model,
      trace: {
        providerCalls: 1,
        cacheHits: 1,
        retries: 0,
        modelFallbacks: 1,
        providerFallbacks: 0,
        splits: 0,
      },
    })
    expect(second.trace?.payloadBytes).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('refresh bypasses the successful fallback cache and obtains fresh evidence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('model not found', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'old' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('model not found', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'fresh' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const vision = adapter()
    const base = { prompt: 'read all text', images: [image] }
    expect((await vision.call('p', base)).text).toBe('old')
    expect((await vision.call('p', { ...base, cache: 'refresh' })).text).toBe('fresh')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
