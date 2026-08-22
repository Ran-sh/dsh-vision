/** @vitest-environment node */

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJsonl, scoreBenchmark } from '../scripts/vision-benchmark-score.mjs'
import { compareBenchmarkRuns } from '../scripts/vision-benchmark-compare.mjs'
import {
  PNG_LONG_COMPRESS_MAX_EDGE,
  PNG_MAX_PIXELS,
  targetImageDimensions,
} from '../packages/image-mind/src/client/attach.ts'

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
const longPreprocess = JSON.parse(readFileSync(resolve(benchmarkRoot, 'reports/015-long-image-preprocess.json'), 'utf8')) as {
  policy: { current: { maxEdge: number; maxPixels: number } }
  comparisons: Array<{
    fixture: string
    source: { width: number; height: number; inputBytes: number }
    currentAspectPixelAware: {
      dimensions: { width: number; height: number }
      outputBytes: number
      processingUnits: number
      readability: { darkPixelRatio: number; sampledRows: number; distinctSampledRows: number; rowOrderHash: string }
    }
    historical3072LongEdge: {
      dimensions: { width: number; height: number }
      outputBytes: number
      processingUnits: number
      readability: { darkPixelRatio: number; sampledRows: number; distinctSampledRows: number; rowOrderHash: string }
    }
    assertions: Record<string, boolean>
  }>
}

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

  it('keeps expected visual answers out of prompts and guards the generator template', () => {
    const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase()
    for (const row of cases) {
      const prompt = normalize(row.prompt)
      for (const token of [
        ...(row.assertion?.containsAll ?? []),
        ...(row.assertion?.containsAny ?? []),
        ...(row.assertion?.excludes ?? []),
      ]) {
        expect(prompt, `${row.id} prompt must not contain assertion token ${token}`).not.toContain(normalize(token))
      }
    }

    // Keep the generator honest as well as the frozen output: an answer token
    // interpolation in the prompt template would recreate the contamination
    // on the next corpus regeneration.
    const generator = readFileSync(resolve(import.meta.dirname, '../scripts/generate-vision-benchmark-corpus.mjs'), 'utf8')
    expect(generator).not.toMatch(/prompt:\s*`[^`]*\$\{[^}]*fact/)
    expect(generator).not.toContain('Fixture fact')
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

  it('executes and records the historical 3072-long-edge comparison', () => {
    expect(longPreprocess.policy.current).toMatchObject({ maxEdge: PNG_LONG_COMPRESS_MAX_EDGE, maxPixels: PNG_MAX_PIXELS })
    expect(longPreprocess.comparisons).toHaveLength(2)
    for (const comparison of longPreprocess.comparisons) {
      const current = comparison.currentAspectPixelAware
      const historical = comparison.historical3072LongEdge
      const expectedCurrent = targetImageDimensions(comparison.source.width, comparison.source.height, {
        maxEdge: PNG_LONG_COMPRESS_MAX_EDGE,
        maxPixels: PNG_MAX_PIXELS,
        outputType: 'image/png',
      })
      const expectedHistorical = targetImageDimensions(comparison.source.width, comparison.source.height, {
        maxEdge: 3072,
        outputType: 'image/png',
      })
      expect(current.dimensions).toEqual({ width: expectedCurrent.width, height: expectedCurrent.height })
      expect(historical.dimensions).toEqual({ width: expectedHistorical.width, height: expectedHistorical.height })
      expect(current.outputBytes).toBeGreaterThan(0)
      expect(historical.outputBytes).toBeGreaterThan(0)
      expect(current.processingUnits).toBeGreaterThan(comparison.source.inputBytes)
      expect(historical.processingUnits).toBeGreaterThan(comparison.source.inputBytes)
      expect(current.readability.sampledRows).toBeGreaterThan(1)
      expect(historical.readability.sampledRows).toBeGreaterThan(1)
      expect(current.readability.distinctSampledRows).toBeGreaterThan(1)
      expect(historical.readability.distinctSampledRows).toBeGreaterThan(1)
      expect(current.readability.rowOrderHash).toMatch(/^[0-9a-f]{64}$/)
      expect(historical.readability.rowOrderHash).toMatch(/^[0-9a-f]{64}$/)
      expect(Object.values(comparison.assertions).every(Boolean)).toBe(true)
    }
  })

  it('passes the auditable deterministic baseline-vs-layered candidate gate', () => {
    const report = compareBenchmarkRuns(cases, baseline, candidate)
    expect(report.comparison.pass).toBe(true)
    expect(report.baseline.taskSuccessRate).toBe(1)
    expect(report.candidate.taskSuccessRate).toBe(1)
    expect(report.candidate.routeSources).toMatchObject({ provider: 80, evidenceCache: 20 })
    expect(report.candidate.zeroProviderReuseRate).toBeCloseTo(0.2)
    expect(report.candidate.totals.calls).toBe(80)
    expect(report.candidate.routeDecisionConsistencyRate).toBe(1)
    expect(report.candidate.routeSourceOutcomes.evidenceCache).toMatchObject({
      cases: 20,
      providerCalls: 0,
      cacheHits: 20,
      taskSuccessRate: 1,
    })
    expect(scoreBenchmark(cases, baseline).forbiddenHitCount).toBe(0)
    expect(baseline.find(row => row.id === 'compare-01-broad')?.answer).toContain('Image 1: COMPARE-FACT-01')
    expect(baseline.find(row => row.id === 'compare-01-broad')?.answer).toContain('Image 2: COMPARE-FACT-02')
    expect(candidate.find(row => row.id === 'compare-02-followup')?.answer).toContain('Image 1: COMPARE-FACT-01')
    expect(candidate.find(row => row.id === 'compare-02-followup')?.answer).toContain('Image 2: COMPARE-FACT-02')
  })
})
