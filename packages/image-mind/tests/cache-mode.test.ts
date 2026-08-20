/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import { createVisionCache } from '../src/cache/vision-cache.ts'

const image = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

function response(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function adapter() {
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: () => ({
      provider: 'p',
      baseURL: 'https://example.test/v1',
      model: 'vision-model',
      apiStyle: 'chat-completions',
      maxOutputTokens: 256,
      timeoutMs: 10_000,
      apiKeyEnv: 'KEY',
    }),
    resolveApiKey: async () => 'test-key',
    cache: createVisionCache({ ttlMs: 60_000 }),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('vision request cache modes', () => {
  it('use reuses a fresh semantic hit', async () => {
    const fetchMock = vi.fn(async () => response('first'))
    vi.stubGlobal('fetch', fetchMock)
    const vision = adapter()
    const request = { prompt: 'read it', images: [image], cache: 'use' as const }
    expect((await vision.call('p', request)).text).toBe('first')
    expect((await vision.call('p', request)).text).toBe('first')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refresh skips the hit and replaces it with the fresh result', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('old'))
      .mockResolvedValueOnce(response('fresh'))
    vi.stubGlobal('fetch', fetchMock)
    const vision = adapter()
    const base = { prompt: 'read it', images: [image] }
    expect((await vision.call('p', base)).text).toBe('old')
    expect((await vision.call('p', { ...base, cache: 'refresh' })).text).toBe('fresh')
    expect((await vision.call('p', { ...base, cache: 'use' })).text).toBe('fresh')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('no-store bypasses reads and writes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('one'))
      .mockResolvedValueOnce(response('two'))
      .mockResolvedValueOnce(response('three'))
    vi.stubGlobal('fetch', fetchMock)
    const vision = adapter()
    const request = { prompt: 'read it', images: [image], cache: 'no-store' as const }
    expect((await vision.call('p', request)).text).toBe('one')
    expect((await vision.call('p', request)).text).toBe('two')
    expect((await vision.call('p', { prompt: 'read it', images: [image], cache: 'use' })).text).toBe('three')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
