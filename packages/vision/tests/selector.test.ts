import { describe, expect, it } from 'vitest'
import { createVisionProviderHealth } from '../src/health.ts'
import { selectVisionProvider } from '../src/selector.ts'
import type { VisionCircuitSnapshot } from '../src/circuit-breaker.ts'

const closed: VisionCircuitSnapshot = { state: 'closed', failures: 0, openedAt: null, nextProbeAt: null }

function health(successes: number, failures: number, latency: number, consecutiveFailures = 0) {
  return {
    ...createVisionProviderHealth(),
    successes,
    failures,
    totalLatencyMs: latency,
    consecutiveFailures,
  }
}

describe('vision selector', () => {
  it('keeps explicit provider choice instead of silently rerouting', () => {
    const result = selectVisionProvider({
      task: 'ocr',
      explicitProvider: 'slow',
      now: 1000,
      candidates: [
        { provider: 'fast', health: health(10, 0, 1000), circuit: closed, tasks: ['ocr'] },
        { provider: 'slow', health: health(1, 4, 10000), circuit: closed, tasks: ['ocr'] },
      ],
    })
    expect(result.selected?.provider).toBe('slow')
    expect(result.selected?.reason).toBe('explicit')
    expect(result.ranked).toHaveLength(1)
  })

  it('fails closed for an explicit provider whose circuit is cooling down', () => {
    const result = selectVisionProvider({
      task: 'general',
      explicitProvider: 'broken',
      now: 1000,
      candidates: [{
        provider: 'broken',
        health: health(0, 3, 3000, 3),
        circuit: { state: 'open', failures: 3, openedAt: 500, nextProbeAt: 2000 },
      }],
    })
    expect(result.selected).toBeUndefined()
    expect(result.skipped).toEqual([{ provider: 'broken', reason: 'circuit-open' }])
  })

  it('filters task-incompatible and cooling providers before ranking', () => {
    const result = selectVisionProvider({
      task: 'ocr',
      now: 1000,
      candidates: [
        { provider: 'photo-only', health: health(10, 0, 1000), circuit: closed, tasks: ['photo'] },
        {
          provider: 'open',
          health: health(10, 0, 1000),
          circuit: { state: 'open', failures: 3, openedAt: 500, nextProbeAt: 2000 },
          tasks: ['ocr'],
        },
        { provider: 'ocr', health: health(8, 1, 1500), circuit: closed, tasks: ['ocr'] },
      ],
    })
    expect(result.selected?.provider).toBe('ocr')
    expect(result.skipped).toEqual([
      { provider: 'photo-only', reason: 'task-unsupported' },
      { provider: 'open', reason: 'circuit-open' },
    ])
  })

  it('prefers a healthier closed route over a half-open probe', () => {
    const result = selectVisionProvider({
      task: 'general',
      now: 5000,
      candidates: [
        {
          provider: 'probe',
          health: health(10, 0, 1000),
          circuit: { state: 'half-open', failures: 3, openedAt: 1000, nextProbeAt: 4000 },
        },
        { provider: 'stable', health: health(9, 1, 1200), circuit: closed },
      ],
    })
    expect(result.selected?.provider).toBe('stable')
  })

  it('uses provider id as a stable final tie-breaker', () => {
    const result = selectVisionProvider({
      task: 'general',
      now: 1000,
      candidates: [
        { provider: 'zeta', health: health(0, 0, 0), circuit: closed },
        { provider: 'alpha', health: health(0, 0, 0), circuit: closed },
      ],
    })
    expect(result.ranked.map(item => item.provider)).toEqual(['alpha', 'zeta'])
  })
})
