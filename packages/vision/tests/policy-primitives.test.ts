import { describe, expect, it } from 'vitest'
import {
  createVisionCircuitBreaker,
  createVisionProviderHealth,
  createVisionTokenBudget,
  routeVisionTask,
  scoreVisionProviderHealth,
} from '../src/index.ts'

describe('provider health scoring', () => {
  it('penalizes repeated failures and latency without producing negative scores', () => {
    const fresh = createVisionProviderHealth()
    expect(scoreVisionProviderHealth(fresh, 1000)).toEqual({ score: 1, healthy: true })

    const degraded = {
      ...fresh,
      successes: 2,
      failures: 3,
      consecutiveFailures: 3,
      totalLatencyMs: 25_000,
    }
    const scored = scoreVisionProviderHealth(degraded, 1000)
    expect(scored.score).toBeGreaterThanOrEqual(0)
    expect(scored.score).toBeLessThan(1)
  })
})

describe('provider circuit breaker', () => {
  it('opens after the threshold, admits one half-open probe after cooldown, then closes on success', () => {
    const breaker = createVisionCircuitBreaker({ failureThreshold: 2, cooldownMs: 100 })
    breaker.recordFailure(1000)
    expect(breaker.snapshot().state).toBe('closed')
    breaker.recordFailure(1010)
    expect(breaker.snapshot().state).toBe('open')
    expect(breaker.allow(1050)).toBe(false)
    expect(breaker.allow(1110)).toBe(true)
    expect(breaker.snapshot().state).toBe('half-open')
    expect(breaker.allow(1111)).toBe(false)
    expect(breaker.allow(5000)).toBe(false)
    breaker.recordSuccess()
    expect(breaker.snapshot()).toMatchObject({ state: 'closed', failures: 0 })
    expect(breaker.allow(5001)).toBe(true)
  })

  it('reopens immediately when a half-open probe fails', () => {
    const breaker = createVisionCircuitBreaker({ failureThreshold: 1, cooldownMs: 10 })
    breaker.recordFailure(100)
    expect(breaker.allow(111)).toBe(true)
    expect(breaker.allow(111)).toBe(false)
    breaker.recordFailure(112)
    expect(breaker.snapshot()).toMatchObject({ state: 'open', openedAt: 112 })
  })

  it('rejects invalid breaker policies instead of creating degenerate state machines', () => {
    expect(() => createVisionCircuitBreaker({ failureThreshold: 0 })).toThrow(/failureThreshold/)
    expect(() => createVisionCircuitBreaker({ failureThreshold: 1.5 })).toThrow(/failureThreshold/)
    expect(() => createVisionCircuitBreaker({ cooldownMs: -1 })).toThrow(/cooldownMs/)
  })
})

describe('task quality policy', () => {
  it('uses token-budget as the single source of truth', () => {
    for (const task of ['ocr', 'ui-review', 'code', 'document', 'chart', 'compare', 'photo', 'general'] as const) {
      expect(routeVisionTask(task).policy).toEqual(createVisionTokenBudget(task))
    }
  })

  it('spends materially less on photos than OCR-heavy tasks', () => {
    const photo = createVisionTokenBudget('photo')
    const ocr = createVisionTokenBudget('ocr')
    expect(photo.maxPixels).toBeLessThan(ocr.maxPixels)
    expect(photo.maxOutputTokens).toBeLessThan(ocr.maxOutputTokens)
    expect(photo.preferLossless).toBe(false)
    expect(ocr.preferLossless).toBe(true)
  })
})
