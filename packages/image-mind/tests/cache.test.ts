/**
 * Vision cache tests: TTL expiry, capacity cap, and — critically — that the
 * semantic key separates providers, models, prompts, and images so a config
 * change can never hit an old provider's answer.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { createVisionCache } from '../src/cache/vision-cache.ts'
import { semanticRequestKey } from '../src/adapters/openai-compatible/adapter.ts'
import type { OpenAICompatibleVisionOptions } from '../src/adapters/openai-compatible/types.ts'

function connection(overrides: Partial<OpenAICompatibleVisionOptions> = {}): OpenAICompatibleVisionOptions {
  return {
    provider: 'a',
    baseURL: 'https://api.a.example/v1',
    model: 'm1',
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 60_000,
    ...overrides,
  }
}

const IMAGE_A = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }
const IMAGE_B = { bytes: Buffer.from([4, 5, 6]), mimeType: 'image/png' as const }

describe('createVisionCache', () => {
  it('stores and retrieves within the TTL', () => {
    const cache = createVisionCache({ ttlMs: 10_000 })
    cache.set('k', 'v')
    expect(cache.get('k')).toBe('v')
    expect(cache.size).toBe(1)
  })

  it('expires entries after the TTL', async () => {
    const cache = createVisionCache({ ttlMs: 5 })
    cache.set('k', 'v')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(cache.get('k')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('caps capacity and evicts the oldest', () => {
    const cache = createVisionCache({ ttlMs: 60_000, maxEntries: 2 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
  })

  it('clears everything', () => {
    const cache = createVisionCache()
    cache.set('a', '1')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })
})

describe('semanticRequestKey (cache isolation)', () => {
  it('separates provider A from provider B', () => {
    const keyA = semanticRequestKey(connection({ provider: 'a' }), 'p', [IMAGE_A])
    const keyB = semanticRequestKey(connection({ provider: 'b' }), 'p', [IMAGE_A])
    expect(keyA).not.toBe(keyB)
  })

  it('separates model A from model B', () => {
    const keyA = semanticRequestKey(connection({ model: 'm1' }), 'p', [IMAGE_A])
    const keyB = semanticRequestKey(connection({ model: 'm2' }), 'p', [IMAGE_A])
    expect(keyA).not.toBe(keyB)
  })

  it('separates baseURL changes', () => {
    const keyA = semanticRequestKey(connection({ baseURL: 'https://a/v1' }), 'p', [IMAGE_A])
    const keyB = semanticRequestKey(connection({ baseURL: 'https://b/v1' }), 'p', [IMAGE_A])
    expect(keyA).not.toBe(keyB)
  })

  it('separates protocol styles', () => {
    const keyA = semanticRequestKey(connection({ apiStyle: 'chat-completions' }), 'p', [IMAGE_A])
    const keyB = semanticRequestKey(connection({ apiStyle: 'responses' }), 'p', [IMAGE_A])
    expect(keyA).not.toBe(keyB)
  })

  it('separates prompts', () => {
    const keyA = semanticRequestKey(connection(), 'describe', [IMAGE_A])
    const keyB = semanticRequestKey(connection(), 'transcribe', [IMAGE_A])
    expect(keyA).not.toBe(keyB)
  })

  it('separates images', () => {
    const keyA = semanticRequestKey(connection(), 'p', [IMAGE_A])
    const keyB = semanticRequestKey(connection(), 'p', [IMAGE_B])
    expect(keyA).not.toBe(keyB)
  })
})
