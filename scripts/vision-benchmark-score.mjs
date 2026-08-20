#!/usr/bin/env node

/**
 * Deterministic scorer for the dsh-vision visual-quality benchmark.
 *
 * This script does NOT call any provider. It joins a JSONL case manifest with
 * JSONL execution results produced later in a real DSH/provider environment,
 * then computes routing, assertion, latency, and recovery metrics. Keeping
 * scoring offline makes baseline-vs-candidate comparisons reproducible.
 */

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/** Normalize text for resilient benchmark assertions without hiding content. */
export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Parse non-empty JSONL records. */
export function parseJsonl(text) {
  const rows = []
  for (const [index, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    try {
      rows.push(JSON.parse(line))
    } catch (error) {
      throw new Error(`invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return rows
}

/** Linear-interpolated percentile over finite values. */
export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return undefined
  if (sorted.length === 1) return sorted[0]
  const rank = Math.max(0, Math.min(1, p)) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low)
}

/** Score one answer against manifest assertions. */
export function scoreAssertions(testCase, result) {
  const answer = normalizeText(result?.answer)
  const assertion = testCase.assertion ?? {}
  const containsAll = (assertion.containsAll ?? []).map(normalizeText)
  const containsAny = (assertion.containsAny ?? []).map(normalizeText)
  const excludes = (assertion.excludes ?? []).map(normalizeText)
  const expectedText = assertion.expectedText === undefined ? undefined : normalizeText(assertion.expectedText)

  const checks = []
  for (const term of containsAll) checks.push(answer.includes(term))
  if (containsAny.length > 0) checks.push(containsAny.some(term => answer.includes(term)))
  for (const term of excludes) checks.push(!answer.includes(term))
  if (expectedText !== undefined) checks.push(answer.includes(expectedText))

  const assertionPass = checks.length === 0 ? true : checks.every(Boolean)
  const forbiddenHits = excludes.filter(term => answer.includes(term)).length
  return { assertionPass, forbiddenHits, checks: checks.length }
}

/** Score all cases and aggregate stable benchmark metrics. */
export function scoreBenchmark(cases, results) {
  const resultById = new Map(results.map(result => [result.id, result]))
  const rows = []

  for (const testCase of cases) {
    if (typeof testCase.id !== 'string' || testCase.id.length === 0) throw new Error('benchmark case missing non-empty id')
    const result = resultById.get(testCase.id)
    const assertion = scoreAssertions(testCase, result)
    const toolCalled = result?.toolCalled === true
    const success = result !== undefined && result.error == null && toolCalled && assertion.assertionPass
    rows.push({
      id: testCase.id,
      category: testCase.category ?? 'uncategorized',
      weight: Number.isFinite(testCase.weight) && testCase.weight > 0 ? testCase.weight : 1,
      missing: result === undefined,
      toolCalled,
      success,
      assertionPass: assertion.assertionPass,
      forbiddenHits: assertion.forbiddenHits,
      latencyMs: Number(result?.latencyMs),
      calls: Number(result?.calls ?? 0),
      payloadBytes: Number(result?.payloadBytes ?? 0),
      retries: Number(result?.retries ?? 0),
      modelFallbacks: Number(result?.modelFallbacks ?? 0),
      providerFallbacks: Number(result?.providerFallbacks ?? 0),
      splits: Number(result?.splits ?? 0),
    })
  }

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0)
  const weighted = (predicate) => totalWeight === 0 ? 0 : rows.reduce((sum, row) => sum + (predicate(row) ? row.weight : 0), 0) / totalWeight
  const latencies = rows.filter(row => row.success && Number.isFinite(row.latencyMs)).map(row => row.latencyMs)
  const categories = {}
  for (const row of rows) {
    const bucket = categories[row.category] ??= { cases: 0, passed: 0, missing: 0 }
    bucket.cases += 1
    if (row.success) bucket.passed += 1
    if (row.missing) bucket.missing += 1
  }
  for (const bucket of Object.values(categories)) bucket.passRate = bucket.cases === 0 ? 0 : bucket.passed / bucket.cases

  return {
    cases: rows.length,
    missing: rows.filter(row => row.missing).length,
    routingSuccessRate: weighted(row => row.toolCalled),
    assertionPassRate: weighted(row => row.assertionPass && !row.missing),
    taskSuccessRate: weighted(row => row.success),
    forbiddenHitCount: rows.reduce((sum, row) => sum + row.forbiddenHits, 0),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    totals: {
      calls: rows.reduce((sum, row) => sum + row.calls, 0),
      payloadBytes: rows.reduce((sum, row) => sum + row.payloadBytes, 0),
      retries: rows.reduce((sum, row) => sum + row.retries, 0),
      modelFallbacks: rows.reduce((sum, row) => sum + row.modelFallbacks, 0),
      providerFallbacks: rows.reduce((sum, row) => sum + row.providerFallbacks, 0),
      splits: rows.reduce((sum, row) => sum + row.splits, 0),
    },
    categories,
    rows,
  }
}

async function main(argv) {
  if (argv.length < 2) {
    console.error('usage: node scripts/vision-benchmark-score.mjs <cases.jsonl> <results.jsonl>')
    process.exitCode = 2
    return
  }
  const [casePath, resultPath] = argv
  const [caseText, resultText] = await Promise.all([readFile(casePath, 'utf8'), readFile(resultPath, 'utf8')])
  const score = scoreBenchmark(parseJsonl(caseText), parseJsonl(resultText))
  console.log(JSON.stringify(score, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main(process.argv.slice(2))
}
