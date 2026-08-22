/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter, credentialCacheFingerprint } from '../src/adapters/openai-compatible/index.ts'
import type { VisionCache } from '../src/cache/vision-cache.ts'

const image = { bytes: Buffer.from([7, 8, 9]), mimeType: 'image/png' as const }

function response(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function connection() {
  return {
    provider: 'p',
    baseURL: 'https://example.test/v1',
    model: 'vision-model',
    apiStyle: 'chat-completions' as const,
    maxOutputTokens: 256,
    timeoutMs: 10_000,
    apiKeyEnv: 'KEY',
  }
}

function recordingCache(): VisionCache & { keys: string[] } {
  const entries = new Map<string, string>()
  const keys: string[] = []
  return {
    keys,
    get(key) {
      keys.push(key)
      return entries.get(key)
    },
    set(key, text) {
      keys.push(key)
      entries.set(key, text)
    },
    get size() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('credential-scoped semantic cache', () => {
  it('changes cache identity immediately when the resolved credential rotates', async () => {
    let key = 'sk-credential-A-12345678'
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization')
      return response(authorization === `Bearer ${key}` ? `answer:${key.slice(-1)}` : 'unexpected')
    })
    vi.stubGlobal('fetch', fetchMock)

    const cache = recordingCache()
    const vision = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: () => connection(),
      resolveApiKey: async () => key,
      cache,
    })
    const request = { prompt: 'read it', images: [image], cache: 'use' as const }

    expect((await vision.call('p', request)).text).toBe('answer:A')
    expect((await vision.call('p', request)).text).toBe('answer:A')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    key = 'sk-credential-B-12345678'
    expect((await vision.call('p', request)).text).toBe('answer:B')
    expect((await vision.call('p', request)).text).toBe('answer:B')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    expect(cache.size).toBe(2)
    expect(cache.keys.length).toBeGreaterThan(0)
    for (const cacheKey of cache.keys) {
      expect(cacheKey).toMatch(/^[0-9a-f]{64}$/)
      expect(cacheKey).not.toContain('sk-credential')
      expect(cacheKey).not.toBe(credentialCacheFingerprint('sk-credential-A-12345678'))
      expect(cacheKey).not.toBe(credentialCacheFingerprint('sk-credential-B-12345678'))
    }
  })

  it('keeps concurrent calls with different resolved credentials in separate async-local cache scopes', async () => {
    let selected = 'A'
    const resolveApiKey = vi.fn(async () => {
      const captured = selected
      if (captured === 'A') await new Promise(resolve => setTimeout(resolve, 15))
      return `sk-concurrent-${captured}-12345678`
    })
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? ''
      const marker = authorization.includes('-A-') ? 'A' : 'B'
      return response(`answer:${marker}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const vision = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: () => connection(),
      resolveApiKey,
      cache: recordingCache(),
    })
    const request = { prompt: 'same semantic request', images: [image], cache: 'use' as const }

    selected = 'A'
    const callA = vision.call('p', request)
    await Promise.resolve()
    selected = 'B'
    const callB = vision.call('p', request)

    const [a, b] = await Promise.all([callA, callB])
    expect(a.text).toBe('answer:A')
    expect(b.text).toBe('answer:B')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    selected = 'A'
    expect((await vision.call('p', request)).text).toBe('answer:A')
    selected = 'B'
    expect((await vision.call('p', request)).text).toBe('answer:B')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
