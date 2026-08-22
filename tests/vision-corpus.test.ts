/** @vitest-environment node */

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJsonl, scoreBenchmark } from '../scripts/vision-benchmark-score.mjs'
import { compareBenchmarkRuns } from '../scripts/vision-benchmark-compare.mjs'

const benchmarkRoot = resolve(import.meta.dirname, '../benchmarks/vision')
const manifest = JSON.parse(readFileSync(resolve(benchmarkRoot, 'corpus-manifest.json'), 'utf8')) as {
  totalCases: number
  categoryCounts: Record<string, number>
  fixtureRefs: string[]
  fixtureMetadata: Array<{ path: string; width: number; height: number; bytes: number; sha256: string }>
  longScreenshotCases: string[]
}
const cases = parseJsonl(readFileSync(resolve(benchmarkRoot, 'cases.jsonl'), 'utf8'))
const baseline = parseJsonl(readFileSync(resolve(benchmarkRoot, 'results.baseline.jsonl'), 'utf8'))
const candidate = parseJsonl(readFileSync(resolve(benchmarkRoot, 'results.candidate.jsonl'), 'utf8'))

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function expectValidPng(bytes: Buffer): void {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  let offset = 8
  let sawIdat = false
  let sawIend = false
  const idat: Buffer[] = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const expected = bytes.readUInt32BE(offset + 8 + length)
    expect(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]))).toBe(expected)
    if (type === 'IDAT') { sawIdat = true; idat.push(data) }
    if (type === 'IEND') { sawIend = true; break }
    offset += length + 12
  }
  expect(sawIdat).toBe(true)
  expect(sawIend).toBe(true)
  expect(inflateSync(Buffer.concat(idat)).length).toBeGreaterThan(0)
}

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
    expect(new Set(manifest.fixtureMetadata.map(entry => entry.path))).toEqual(new Set(manifest.fixtureRefs))
    expect(manifest.fixtureMetadata.every(entry => entry.bytes > 0 && /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true)
    for (const entry of manifest.fixtureMetadata) {
      const bytes = readFileSync(resolve(benchmarkRoot, entry.path))
      expect(bytes.length).toBe(entry.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      expectValidPng(bytes)
    }
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
      const metadata = manifest.fixtureMetadata.find(entry => entry.path.endsWith(name))
      expect(metadata).toMatchObject({ width, height })
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
    expect(baseline.find(row => row.id === 'compare-01-broad')?.answer).toContain('Image 1: COMPARE-FACT-01')
    expect(baseline.find(row => row.id === 'compare-01-broad')?.answer).toContain('Image 2: COMPARE-FACT-02')
    expect(candidate.find(row => row.id === 'compare-02-followup')?.answer).toContain('Image 1: COMPARE-FACT-01')
    expect(candidate.find(row => row.id === 'compare-02-followup')?.answer).toContain('Image 2: COMPARE-FACT-02')
  })
})
