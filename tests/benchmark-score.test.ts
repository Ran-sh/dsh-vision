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

  it('joins cases/results and aggregates routing, quality, latency, recovery, route decisions, and cost metrics', () => {
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
        route: {
          source: 'provider', task: 'ocr', cacheMode: 'use', evidenceLayerEnabled: true,
          selectedProvider: 'primary', selectedModel: 'vision-a',
          modelFallback: false, providerFallback: false,
        },
      },
      {
        id: 'ui-1', answer: 'The panel is clipped.', toolCalled: true, latencyMs: 300,
        providerCalls: 3, payloadBytes: 2500, cacheHits: 1, inputTokens: 300, outputTokens: 40,
        retries: 1, modelFallbacks: 1, providerFallbacks: 1, splits: 1,
        route: {
          source: 'provider', task: 'ui-review', cacheMode: 'use', evidenceLayerEnabled: false,
          requestedProvider: 'primary', requestedModel: 'vision-a',
          selectedProvider: 'backup', selectedModel: 'vision-b',
          modelFallback: true, providerFallback: true,
        },
      },
    ])

    expect(score.cases).toBe(3)
    expect(score.missing).toBe(1)
    expect(score.routingSuccessRate).toBe(0.75)
    expect(score.taskSuccessRate).toBe(0.75)
    expect(score.traceCoverage).toBe(0.75)
    expect(score.routeCoverage).toBe(0.75)
    expect(score.routeDecisionCoverage).toBe(0.75)
    expect(score.routeTraceConsistencyRate).toBe(1)
    expect(score.routeDecisionConsistencyRate).toBe(1)
    expect(score.evidenceLayerEnabledRate).toBeCloseTo(1 / 3)
    expect(score.routeSources).toEqual({ provider: 2, semanticCache: 0, evidenceCache: 0, unknown: 0 })
    expect(score.routeTasks).toMatchObject({ ocr: 1, 'ui-review': 1, unknown: 0 })
    expect(score.routeCacheModes).toEqual({ use: 2, refresh: 0, noStore: 0, unknown: 0 })
    expect(score.evidenceLayer).toEqual({ enabled: 1, disabled: 1, unknown: 0 })
    expect(score.routeSourceOutcomes.provider).toMatchObject({
      cases: 2,
      passed: 2,
      weight: 3,
      providerCalls: 4,
      cacheHits: 1,
      passRate: 1,
      taskSuccessRate: 1,
    })
    expect(score.routeSourceOutcomes.unknown.cases).toBe(0)
    expect(score.rows[1]).toMatchObject({
      routeTask: 'ui-review',
      routeCacheMode: 'use',
      evidenceLayerEnabled: false,
      requestedProvider: 'primary',
      requestedModel: 'vision-a',
      selectedProvider: 'backup',
      selectedModel: 'vision-b',
      routeTraceConsistent: true,
      routeDecisionConsistent: true,
    })
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

  it('distinguishes semantic and evidence cache route sources and their quality', () => {
    const score = scoreBenchmark([
      { id: 'semantic', assertion: { containsAll: ['facts'] } },
      { id: 'evidence', assertion: { containsAll: ['facts'] } },
      { id: 'evidence-bad', weight: 2, assertion: { containsAll: ['needed detail'] } },
    ], [
      {
        id: 'semantic', answer: 'facts', toolCalled: true, providerCalls: 0, cacheHits: 1,
        route: {
          source: 'semantic-cache', task: 'ocr', cacheMode: 'use', evidenceLayerEnabled: true,
          selectedProvider: 'p', selectedModel: 'm', modelFallback: false, providerFallback: false,
        },
      },
      {
        id: 'evidence', answer: 'facts', toolCalled: true, providerCalls: 0, cacheHits: 1,
        route: {
          source: 'evidence-cache', task: 'ocr', cacheMode: 'use', evidenceLayerEnabled: true,
          selectedProvider: 'p', selectedModel: 'm', modelFallback: false, providerFallback: false,
        },
      },
      {
        id: 'evidence-bad', answer: 'broad facts only', toolCalled: true, providerCalls: 0, cacheHits: 1,
        route: {
          source: 'evidence-cache', task: 'ocr', cacheMode: 'use', evidenceLayerEnabled: true,
          selectedProvider: 'p', selectedModel: 'm', modelFallback: false, providerFallback: false,
        },
      },
    ])

    expect(score.routeCoverage).toBe(1)
    expect(score.routeDecisionCoverage).toBe(1)
    expect(score.routeDecisionConsistencyRate).toBe(1)
    expect(score.evidenceLayerEnabledRate).toBe(1)
    expect(score.routeSources).toEqual({ provider: 0, semanticCache: 1, evidenceCache: 2, unknown: 0 })
    expect(score.routeTasks.ocr).toBe(3)
    expect(score.routeCacheModes.use).toBe(3)
    expect(score.routeSourceOutcomes.semanticCache).toMatchObject({
      cases: 1, passed: 1, taskSuccessRate: 1, providerCalls: 0, cacheHits: 1,
    })
    expect(score.routeSourceOutcomes.evidenceCache).toMatchObject({
      cases: 2, passed: 1, weight: 3, taskSuccessRate: 1 / 3, providerCalls: 0, cacheHits: 2,
    })
    expect(score.zeroProviderReuseRate).toBe(1)
  })

  it('flags impossible route decision combinations', () => {
    const score = scoreBenchmark([
      { id: 'bad-evidence' },
      { id: 'bad-explicit' },
      { id: 'good-refresh' },
    ], [
      {
        id: 'bad-evidence', answer: 'facts', toolCalled: true, providerCalls: 0, cacheHits: 1,
        route: {
          source: 'evidence-cache', task: 'ocr', cacheMode: 'no-store', evidenceLayerEnabled: false,
          selectedProvider: 'p', selectedModel: 'm', modelFallback: false, providerFallback: false,
        },
      },
      {
        id: 'bad-explicit', answer: 'facts', toolCalled: true, providerCalls: 1, cacheHits: 0,
        route: {
          source: 'provider', task: 'ocr', cacheMode: 'use', evidenceLayerEnabled: true,
          requestedProvider: 'p', selectedProvider: 'p', selectedModel: 'm',
          modelFallback: false, providerFallback: false,
        },
      },
      {
        id: 'good-refresh', answer: 'facts', toolCalled: true, providerCalls: 1, cacheHits: 0,
        route: {
          source: 'provider', task: 'ocr', cacheMode: 'refresh', evidenceLayerEnabled: true,
          selectedProvider: 'p', selectedModel: 'm', modelFallback: false, providerFallback: false,
        },
      },
    ])

    expect(score.routeDecisionCoverage).toBe(1)
    expect(score.routeDecisionConsistencyRate).toBeCloseTo(1 / 3)
    expect(score.rows.map(row => row.routeDecisionConsistent)).toEqual([false, false, true])
    expect(score.routeCacheModes).toEqual({ use: 1, refresh: 1, noStore: 1, unknown: 0 })
  })

  it('flags route/trace fallback disagreement without treating missing route decisions as valid telemetry', () => {
    const score = scoreBenchmark([{ id: 'mismatch' }, { id: 'legacy' }], [
      {
        id: 'mismatch', answer: 'facts', toolCalled: true,
        providerCalls: 2, cacheHits: 0, modelFallbacks: 1, providerFallbacks: 0,
        route: {
          source: 'provider', selectedProvider: 'p', selectedModel: 'm',
          modelFallback: false, providerFallback: false,
        },
      },
      { id: 'legacy', answer: 'facts', toolCalled: true, providerCalls: 1, cacheHits: 0 },
    ])

    expect(score.routeCoverage).toBe(0.5)
    expect(score.routeDecisionCoverage).toBe(0)
    expect(score.routeTraceConsistencyRate).toBe(0)
    expect(score.routeDecisionConsistencyRate).toBeUndefined()
    expect(score.routeSources.unknown).toBe(1)
    expect(score.routeTasks.unknown).toBe(2)
    expect(score.routeSourceOutcomes.unknown).toMatchObject({ cases: 1, passed: 1, providerCalls: 1 })
  })

  it('counts zero-provider cache reuse only when trace telemetry is actually present', () => {
    const score = scoreBenchmark([{ id: 'cached' }, { id: 'unknown' }], [
      { id: 'cached', answer: 'facts', toolCalled: true, providerCalls: 0, cacheHits: 1 },
      { id: 'unknown', answer: 'facts', toolCalled: true },
    ])
    expect(score.zeroProviderReuseRate).toBe(0.5)
    expect(score.traceCoverage).toBe(0.5)
  })

  it('does not count null telemetry as reported zero-cost telemetry', () => {
    const score = scoreBenchmark([{ id: 'nulls' }], [{
      id: 'nulls',
      answer: 'facts',
      toolCalled: true,
      providerCalls: null,
      payloadBytes: null,
      cacheHits: null,
      retries: null,
      modelFallbacks: null,
      providerFallbacks: null,
      splits: null,
      inputTokens: null,
      outputTokens: null,
    }])

    expect(score.traceCoverage).toBe(0)
    expect(score.routeCoverage).toBe(0)
    expect(score.routeDecisionCoverage).toBe(0)
    expect(score.tokenUsageCoverage).toBe(0)
    expect(score.zeroProviderReuseRate).toBe(0)
    expect(score.totals.calls).toBe(0)
    expect(score.totals.inputTokens).toBe(0)
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
