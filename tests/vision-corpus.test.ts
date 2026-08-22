/** @vitest-environment node */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJsonl, scoreBenchmark } from '../scripts/vision-benchmark-score.mjs'
import { compareBenchmarkRuns } from '../scripts/vision-benchmark-compare.mjs'

const benchmarkRoot = resolve('benchmarks/vision')
const manifest = JSON.parse(readFileSync(resolve(benchmarkRoot, 'corpus-manifest.json'), 'utf8')) as {
  totalCases: number
  categoryCounts: Record<string, number>
  fixtureRefs: string[]
  longScreenshotCases: string[]
}
const cases = parseJsonl(readFileSync(resolve(benchmarkRoot, 'cases.jsonl'), 'utf8'))
const baseline = parseJsonl(readFileSync(resolve(benchmarkRoot, 'results.baseline.jsonl'), 'utf8'))
const candidate = parseJsonl(readFileSync(resolve(benchmarkRoot, 'results.candidate.jsonl'), 'utf8'))

describe('frozen Batch 015 vision corpus', () => {
  it('has the required deterministic category mix and repository-safe fixture references', () => {
    expect(manifest.totalCases).toBe(100)
    expect(cases).toHaveLength(100)
    expect(baseline).toHaveLength(100)
    expect(candidate).toHaveLength(100)

    const counts = Object.fromEntries(Object.keys(manifest.categoryCounts).map(category => [
      category,
      cases.filter(row => row.category === category).length,
    ]))
    expect(counts).toEqual(manifest.categoryCounts)
    expect(new Set(cases.map(row => row.id)).size).toBe(100)
    expect(JSON.stringify({ cases, manifest })).not.toMatch(/[A-Za-z]:[\\/]|\/Users\/|\/home\//)

    for (const ref of manifest.fixtureRefs) expect(existsSync(resolve(benchmarkRoot, ref))).toBe(true)
    for (const row of cases) {
      for (const image of row.images) expect(manifest.fixtureRefs).toContain(image)
    }
    expect(manifest.longScreenshotCases).toEqual(['ui-19-broad', 'ui-20-followup', 'document-19-broad', 'document-20-followup'])
    expect(cases.find(row => row.id === 'ui-19-broad')?.images).toEqual(['fixtures/generated/long-1440x10000.png'])
    expect(cases.find(row => row.id === 'ui-20-followup')?.images).toEqual(['fixtures/generated/long-1440x10000.png'])
    expect(cases.find(row => row.id === 'document-19-broad')?.images).toEqual(['fixtures/generated/long-1440x20000.png'])
    expect(cases.find(row => row.id === 'document-20-followup')?.images).toEqual(['fixtures/generated/long-1440x20000.png'])
  })

  it('keeps long screenshot fixture dimensions exact and stable', () => {
    for (const [name, width, height] of [
      ['long-1440x10000.png', 1440, 10_000],
      ['long-1440x20000.png', 1440, 20_000],
    ] as const) {
      const bytes = readFileSync(resolve(benchmarkRoot, 'fixtures/generated', name))
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(bytes.readUInt32BE(16)).toBe(width)
      expect(bytes.readUInt32BE(20)).toBe(height)
    }
  })

  it('passes the auditable deterministic baseline-vs-layered candidate gate', () => {
    const report = compareBenchmarkRuns(cases, baseline, candidate)
    expect(report.comparison.pass).toBe(true)
    expect(report.baseline.taskSuccessRate).toBe(1)
    expect(report.candidate.taskSuccessRate).toBe(1)
    expect(report.candidate.routeSources).toMatchObject({ provider: 58, evidenceCache: 42 })
    expect(report.candidate.zeroProviderReuseRate).toBeCloseTo(0.42)
    expect(report.candidate.totals.calls).toBe(58)
    expect(report.candidate.routeDecisionConsistencyRate).toBe(1)
    expect(report.candidate.routeSourceOutcomes.evidenceCache).toMatchObject({
      cases: 42,
      providerCalls: 0,
      cacheHits: 42,
      taskSuccessRate: 1,
    })
    expect(scoreBenchmark(cases, baseline).forbiddenHitCount).toBe(0)
  })
})
