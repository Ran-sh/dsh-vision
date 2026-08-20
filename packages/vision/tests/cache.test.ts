import { describe, expect, it } from 'vitest'
import { createMemoryVisionCache, createVisionUnderstandingKey } from '../src/index.ts'

describe('layered vision cache', () => {
  it('scopes reusable understanding by task contract', () => {
    expect(createVisionUnderstandingKey('abc', 'ocr')).not.toBe(createVisionUnderstandingKey('abc', 'ui-review'))
  })

  it('expires entries after ttl', () => {
    let now = 1000
    const cache = createMemoryVisionCache({ ttlMs: 100, now: () => now })
    const key = createVisionUnderstandingKey('abc', 'ocr')
    cache.setUnderstanding({ imageKey: key, facts: 'facts', provider: 'p', model: 'm', createdAt: now })
    expect(cache.getUnderstanding(key)?.facts).toBe('facts')
    now = 1100
    expect(cache.getUnderstanding(key)).toBeUndefined()
  })

  it('evicts the least recently used entry when bounded', () => {
    let now = 1000
    const cache = createMemoryVisionCache({ maxEntries: 2, ttlMs: 10_000, now: () => now })
    const a = createVisionUnderstandingKey('a', 'ocr')
    const b = createVisionUnderstandingKey('b', 'ocr')
    const c = createVisionUnderstandingKey('c', 'ocr')
    cache.setUnderstanding({ imageKey: a, facts: 'a', provider: 'p', model: 'm', createdAt: now++ })
    cache.setUnderstanding({ imageKey: b, facts: 'b', provider: 'p', model: 'm', createdAt: now++ })
    expect(cache.getUnderstanding(a)?.facts).toBe('a') // refresh recency
    cache.setUnderstanding({ imageKey: c, facts: 'c', provider: 'p', model: 'm', createdAt: now++ })
    expect(cache.getUnderstanding(b)).toBeUndefined()
    expect(cache.getUnderstanding(a)?.facts).toBe('a')
    expect(cache.getUnderstanding(c)?.facts).toBe('c')
  })
})
