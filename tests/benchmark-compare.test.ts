/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { compareBenchmarkRuns, compareBenchmarkScores } from '../scripts/vision-benchmark-compare.mjs'

function score(overrides: Record<string, unknown> = {}) {
  return {
    cases: 100,
    missing: 0,
    routingSuccessRate: 0.98,
    taskSuccessRate: 0.90,
    forbiddenHitCount: 1,
    traceCoverage: 1,
    routeCoverage: 1,
    routeSources: { provider: 100, semanticCache: 0, evidenceCache: 0, unknown: 0 },
    routeSourceOutcomes: {
      provider: { cases: 100, passed: 90, weight: 100, providerCalls: 100, cacheHits: 0, passRate: 0.9, taskSuccessRate: 0.9 },
      semanticCache: { cases: 0, passed: 0, weight: 0, providerCalls: 0, cacheHits: 0 },
      evidenceCache: { cases: 0, passed: 0, weight: 0, providerCalls: 0, cacheHits: 0 },
      unknown: { cases: 0, passed: 0, weight: 0, providerCalls: 0, cacheHits: 0 },
    },
    tokenUsageCoverage: 0.8,
    zeroProviderReuseRate: 0,
    latencyMs: { p50: 500, p95: 1000 },
    totals: {
      calls: 100,
      payloadBytes: 1_000_000,
      cacheHits: 0,
      inputTokens: 100_000,
      outputTokens: 30_000,
      retries: 0,
      modelFallbacks: 0,
      providerFallbacks: 0,
      splits: 0,
    },
    ...overrides,
  }
}

describe('vision benchmark regression gate', () => {
  it('passes a quality-neutral candidate that reduces provider work', () => {
    const baseline = score()
    const candidate = score({
      taskSuccessRate: 0.91,
      zeroProviderReuseRate: 0.25,
      routeSources: { provider: 75, semanticCache: 0, evidenceCache: 25, unknown: 0 },
      routeSourceOutcomes: {
        provider: { cases: 75, passed: 69, weight: 75, providerCalls: 75, cacheHits: 0, passRate: 0.92, taskSuccessRate: 0.92 },
        semanticCache: { cases: 0, passed: 0, weight: 0, providerCalls: 0, cacheHits: 0 },
        evidenceCache: { cases: 25, passed: 22, weight: 25, providerCalls: 0, cacheHits: 25, passRate: 0.88, taskSuccessRate: 0.88 },
        unknown: { cases: 0, passed: 0, weight: 0, providerCalls: 0, cacheHits: 0 },
      },
      totals: { ...score().totals, calls: 75, payloadBytes: 800_000, inputTokens: 72_000 },
    })

    const comparison = compareBenchmarkScores(baseline, candidate)
    expect(comparison.pass).toBe(true)
    expect(comparison.summary.candidateCalls).toBe(75)
    expect(comparison.summary.candidateZeroProviderReuseRate).toBe(0.25)
    expect(comparison.summary.candidateRouteSources).toMatchObject({ evidenceCache: 25 })
    expect(comparison.summary.candidateRouteSourceOutcomes.evidenceCache).toMatchObject({
      cases: 25,
      taskSuccessRate: 0.88,
      providerCalls: 0,
    })
  })

  it('fails when task quality regresses beyond the default tolerance', () => {
    const comparison = compareBenchmarkScores(score(), score({ taskSuccessRate: 0.86 }))
    expect(comparison.pass).toBe(false)
    expect(comparison.checks.find(check => check.name === 'task-success-rate')).toMatchObject({ pass: false })
  })

  it('never trades new forbidden/hallucinated content for lower cost', () => {
    const candidate = score({
      forbiddenHitCount: 2,
      totals: { ...score().totals, calls: 20, inputTokens: 20_000 },
    })
    const comparison = compareBenchmarkScores(score(), candidate)
    expect(comparison.pass).toBe(false)
    expect(comparison.checks.find(check => check.name === 'forbidden-hit-count')).toMatchObject({ pass: false })
  })

  it('does not treat newly available token telemetry as a cost regression', () => {
    const baseline = score({
      tokenUsageCoverage: 0,
      totals: { ...score().totals, inputTokens: 0, outputTokens: 0 },
    })
    const candidate = score({
      tokenUsageCoverage: 1,
      totals: { ...score().totals, inputTokens: 120_000, outputTokens: 35_000 },
    })
    const comparison = compareBenchmarkScores(baseline, candidate)
    expect(comparison.pass).toBe(true)
    expect(comparison.checks.find(check => check.name === 'input-tokens')).toMatchObject({
      pass: true,
      skipped: true,
    })
  })

  it('fails when trace coverage drops enough to make cost totals untrustworthy', () => {
    const comparison = compareBenchmarkScores(score(), score({ traceCoverage: 0.6 }))
    expect(comparison.pass).toBe(false)
    expect(comparison.checks.find(check => check.name === 'trace-coverage')).toMatchObject({ pass: false })
    expect(comparison.checks.find(check => check.name === 'provider-calls')).toMatchObject({
      pass: true,
      skipped: true,
    })
  })

  it('fails when route telemetry coverage regresses materially', () => {
    const comparison = compareBenchmarkScores(score(), score({ routeCoverage: 0.7 }))
    expect(comparison.pass).toBe(false)
    expect(comparison.checks.find(check => check.name === 'route-coverage')).toMatchObject({
      pass: false,
      baseline: 1,
      candidate: 0.7,
    })
  })

  it('scores baseline and candidate from the same frozen corpus', () => {
    const cases = [{ id: 'ocr', category: 'ocr', assertion: { containsAll: ['ERROR 42'] } }]
    const baseline = [{
      id: 'ocr', answer: 'ERROR 42', toolCalled: true, latencyMs: 1000,
      providerCalls: 1, payloadBytes: 1000, cacheHits: 0, inputTokens: 100, outputTokens: 20,
      route: {
        source: 'provider', selectedProvider: 'p', selectedModel: 'm',
        modelFallback: false, providerFallback: false,
      },
    }]
    const candidate = [{
      id: 'ocr', answer: 'ERROR 42', toolCalled: true, latencyMs: 100,
      providerCalls: 0, payloadBytes: 0, cacheHits: 1, inputTokens: 0, outputTokens: 0,
      route: {
        source: 'evidence-cache', selectedProvider: 'p', selectedModel: 'm',
        modelFallback: false, providerFallback: false,
      },
    }]

    const report = compareBenchmarkRuns(cases, baseline, candidate)
    expect(report.comparison.pass).toBe(true)
    expect(report.candidate.zeroProviderReuseRate).toBe(1)
    expect(report.candidate.routeSources.evidenceCache).toBe(1)
    expect(report.candidate.routeSourceOutcomes.evidenceCache).toMatchObject({
      cases: 1,
      passed: 1,
      taskSuccessRate: 1,
    })
    expect(report.candidate.totals.calls).toBe(0)
  })
})
