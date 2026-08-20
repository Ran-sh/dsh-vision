/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { parseJsonl, percentile, scoreBenchmark } from '../scripts/vision-benchmark-score.mjs'

describe('vision benchmark scorer', () => {
  it('parses comments/blank lines and reports malformed JSONL precisely', () => {
    expect(parseJsonl('# comment\n\n{"id":"a"}\n')).toEqual([{ id: 'a' }])
    expect(() => parseJsonl('{bad json}\n')).toThrow(/line 1/)
  })

  it('computes interpolated percentiles', () => {
    expect(percentile([100, 200, 300, 400], 0.5)).toBe(250)
    expect(percentile([100, 200, 300, 400], 0.95)).toBeCloseTo(385)
  })

  it('joins cases/results and aggregates routing, quality, latency, recovery, and cost metrics', () => {
    const score = scoreBenchmark([
      {
        id: 'ocr-1', category: 'ocr',
        assertion: { containsAll: ['ERROR 42'], excludes: ['made up'] },
      },
      {
        id: 'ui-1', category: 'ui', weight: 2,
        assertion: { containsAny: ['overflow', 'clipped'] },
      },
      { id: 'missing', category: 'photo' },
    ], [
      {
        id: 'ocr-1', answer: 'ERROR 42', toolCalled: true, latencyMs: 100,
        providerCalls: 1, payloadBytes: 1000, cacheHits: 0, inputTokens: 100, outputTokens: 20,
        retries: 0, modelFallbacks: 0, providerFallbacks: 0, splits: 0,
      },
      {
        id: 'ui-1', answer: 'The panel is clipped.', toolCalled: true, latencyMs: 300,
        providerCalls: 3, payloadBytes: 2500, cacheHits: 1, inputTokens: 300, outputTokens: 40,
        retries: 1, modelFallbacks: 1, providerFallbacks: 1, splits: 1,
      },
    ])

    expect(score.cases).toBe(3)
    expect(score.missing).toBe(1)
    expect(score.routingSuccessRate).toBe(0.75)
    expect(score.taskSuccessRate).toBe(0.75)
    expect(score.traceCoverage).toBe(0.75)
    expect(score.tokenUsageCoverage).toBe(0.75)
    expect(score.latencyMs.p50).toBe(200)
    expect(score.totals.calls).toBe(4)
    expect(score.totals.cacheHits).toBe(1)
    expect(score.totals.inputTokens).toBe(400)
    expect(score.totals.outputTokens).toBe(60)
    expect(score.totals.providerFallbacks).toBe(1)
    expect(score.categories.ocr.passRate).toBe(1)
    expect(score.categories.ui.passRate).toBe(1)
    expect(score.categories.photo.missing).toBe(1)
  })

  it('counts zero-provider cache reuse only when trace telemetry is actually present', () => {
    const score = scoreBenchmark([{ id: 'cached' }, { id: 'unknown' }], [
      { id: 'cached', answer: 'facts', toolCalled: true, providerCalls: 0, cacheHits: 1 },
      { id: 'unknown', answer: 'facts', toolCalled: true },
    ])
    expect(score.zeroProviderReuseRate).toBe(0.5)
    expect(score.traceCoverage).toBe(0.5)
  })

  it('counts forbidden-answer hits as assertion failures', () => {
    const score = scoreBenchmark([
      { id: 'x', assertion: { excludes: ['hallucinated'] } },
    ], [
      { id: 'x', answer: 'hallucinated detail', toolCalled: true },
    ])
    expect(score.forbiddenHitCount).toBe(1)
    expect(score.taskSuccessRate).toBe(0)
  })
})
