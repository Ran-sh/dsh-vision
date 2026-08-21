/**
 * Deterministic scorer for the dsh-vision visual-quality benchmark.
 *
 * This script does NOT call any provider. It joins a JSONL case manifest with
 * JSONL execution results produced later in a real DSH/provider environment,
 * then computes routing, assertion, latency, recovery, and cost metrics.
 * Keeping scoring offline makes baseline-vs-candidate comparisons reproducible.
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

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function hasFiniteField(record, fields) {
  if (record == null) return false
  return fields.some((field) => {
    const value = record[field]
    if (value === null || value === undefined || value === '') return false
    const number = Number(value)
    return Number.isFinite(number) && number >= 0
  })
}

const ROUTE_SOURCES = new Set(['provider', 'semantic-cache', 'evidence-cache'])
const ROUTE_TASKS = [
  'ocr', 'ui-review', 'code', 'document', 'chart', 'compare', 'photo', 'screenshot', 'translate', 'general',
]
const ROUTE_TASK_SET = new Set(ROUTE_TASKS)
const CACHE_MODES = new Set(['use', 'refresh', 'no-store'])

function routeDecisionConsistent(route) {
  if (!route.decisionReported) return undefined
  const explicitRoute = route.requestedProvider !== undefined || route.requestedModel !== undefined
  if (route.evidenceLayerEnabled && route.cacheMode === 'no-store') return false
  if (explicitRoute && route.evidenceLayerEnabled) return false
  if (explicitRoute && (route.modelFallback || route.providerFallback)) return false
  if (route.source === 'evidence-cache' && (!route.evidenceLayerEnabled || route.cacheMode !== 'use')) return false
  if (route.source !== 'provider' && route.cacheMode !== 'use') return false
  return true
}

function routeTelemetry(result) {
  const route = result?.route
  if (route === null || typeof route !== 'object') return { reported: false, decisionReported: false }
  if (!ROUTE_SOURCES.has(route.source)) return { reported: false, decisionReported: false }
  if (typeof route.selectedProvider !== 'string' || route.selectedProvider.length === 0) return { reported: false, decisionReported: false }
  if (typeof route.selectedModel !== 'string' || route.selectedModel.length === 0) return { reported: false, decisionReported: false }
  if (typeof route.modelFallback !== 'boolean' || typeof route.providerFallback !== 'boolean') return { reported: false, decisionReported: false }
  const decisionReported = ROUTE_TASK_SET.has(route.task)
    && CACHE_MODES.has(route.cacheMode)
    && typeof route.evidenceLayerEnabled === 'boolean'
  const parsed = {
    reported: true,
    decisionReported,
    source: route.source,
    requestedProvider: typeof route.requestedProvider === 'string' && route.requestedProvider.length > 0 ? route.requestedProvider : undefined,
    requestedModel: typeof route.requestedModel === 'string' && route.requestedModel.length > 0 ? route.requestedModel : undefined,
    selectedProvider: route.selectedProvider,
    selectedModel: route.selectedModel,
    modelFallback: route.modelFallback,
    providerFallback: route.providerFallback,
    ...(decisionReported ? {
      task: route.task,
      cacheMode: route.cacheMode,
      evidenceLayerEnabled: route.evidenceLayerEnabled,
    } : {}),
  }
  return { ...parsed, decisionConsistent: routeDecisionConsistent(parsed) }
}

function routeSourceBucket(row) {
  if (row.routeSource === 'provider') return 'provider'
  if (row.routeSource === 'semantic-cache') return 'semanticCache'
  if (row.routeSource === 'evidence-cache') return 'evidenceCache'
  return 'unknown'
}

function routeSourceOutcomes(rows) {
  const buckets = {
    provider: { cases: 0, passed: 0, weight: 0, passedWeight: 0, providerCalls: 0, cacheHits: 0 },
    semanticCache: { cases: 0, passed: 0, weight: 0, passedWeight: 0, providerCalls: 0, cacheHits: 0 },
    evidenceCache: { cases: 0, passed: 0, weight: 0, passedWeight: 0, providerCalls: 0, cacheHits: 0 },
    unknown: { cases: 0, passed: 0, weight: 0, passedWeight: 0, providerCalls: 0, cacheHits: 0 },
  }

  for (const row of rows) {
    if (row.missing) continue
    const bucket = buckets[routeSourceBucket(row)]
    bucket.cases += 1
    bucket.weight += row.weight
    bucket.providerCalls += row.calls
    bucket.cacheHits += row.cacheHits
    if (row.success) {
      bucket.passed += 1
      bucket.passedWeight += row.weight
    }
  }

  for (const bucket of Object.values(buckets)) {
    bucket.passRate = bucket.cases === 0 ? undefined : bucket.passed / bucket.cases
    bucket.taskSuccessRate = bucket.weight === 0 ? undefined : bucket.passedWeight / bucket.weight
    delete bucket.passedWeight
  }
  return buckets
}

function routeDecisionBreakdown(rows) {
  const tasks = Object.fromEntries(ROUTE_TASKS.map(task => [task, 0]))
  tasks.unknown = 0
  const cacheModes = { use: 0, refresh: 0, noStore: 0, unknown: 0 }
  const evidenceLayer = { enabled: 0, disabled: 0, unknown: 0 }

  for (const row of rows) {
    if (row.missing) continue
    if (!row.routeDecisionReported) {
      tasks.unknown += 1
      cacheModes.unknown += 1
      evidenceLayer.unknown += 1
      continue
    }
    tasks[row.routeTask] += 1
    if (row.routeCacheMode === 'use') cacheModes.use += 1
    else if (row.routeCacheMode === 'refresh') cacheModes.refresh += 1
    else if (row.routeCacheMode === 'no-store') cacheModes.noStore += 1
    if (row.evidenceLayerEnabled) evidenceLayer.enabled += 1
    else evidenceLayer.disabled += 1
  }

  return { tasks, cacheModes, evidenceLayer }
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
    const calls = finiteNonNegative(result?.providerCalls ?? result?.calls)
    const cacheHits = finiteNonNegative(result?.cacheHits)
    const inputTokens = finiteNonNegative(result?.inputTokens)
    const outputTokens = finiteNonNegative(result?.outputTokens)
    const usageReported = result !== undefined
      && hasFiniteField(result, ['inputTokens', 'outputTokens'])
    const traceReported = result !== undefined
      && hasFiniteField(result, [
        'providerCalls', 'calls', 'payloadBytes', 'cacheHits', 'retries',
        'modelFallbacks', 'providerFallbacks', 'splits',
      ])
    const route = routeTelemetry(result)
    const modelFallbacks = finiteNonNegative(result?.modelFallbacks)
    const providerFallbacks = finiteNonNegative(result?.providerFallbacks)
    const routeTraceConsistent = route.reported && traceReported
      ? route.modelFallback === (modelFallbacks > 0) && route.providerFallback === (providerFallbacks > 0)
      : undefined

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
      calls,
      payloadBytes: finiteNonNegative(result?.payloadBytes),
      cacheHits,
      inputTokens,
      outputTokens,
      usageReported,
      traceReported,
      routeReported: route.reported,
      routeDecisionReported: route.reported && route.decisionReported,
      routeSource: route.reported ? route.source : undefined,
      routeTask: route.reported && route.decisionReported ? route.task : undefined,
      routeCacheMode: route.reported && route.decisionReported ? route.cacheMode : undefined,
      evidenceLayerEnabled: route.reported && route.decisionReported ? route.evidenceLayerEnabled : undefined,
      routeDecisionConsistent: route.reported ? route.decisionConsistent : undefined,
      requestedProvider: route.reported ? route.requestedProvider : undefined,
      requestedModel: route.reported ? route.requestedModel : undefined,
      selectedProvider: route.reported ? route.selectedProvider : undefined,
      selectedModel: route.reported ? route.selectedModel : undefined,
      routeTraceConsistent,
      zeroProviderReuse: result !== undefined && toolCalled && traceReported && calls === 0 && cacheHits > 0,
      retries: finiteNonNegative(result?.retries),
      modelFallbacks,
      providerFallbacks,
      splits: finiteNonNegative(result?.splits),
    })
  }

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0)
  const weighted = (predicate) => totalWeight === 0 ? 0 : rows.reduce((sum, row) => sum + (predicate(row) ? row.weight : 0), 0) / totalWeight
  const weightedAmong = (eligible, predicate) => {
    const eligibleWeight = rows.reduce((sum, row) => sum + (eligible(row) ? row.weight : 0), 0)
    return eligibleWeight === 0 ? undefined : rows.reduce((sum, row) => sum + (eligible(row) && predicate(row) ? row.weight : 0), 0) / eligibleWeight
  }
  const latencies = rows.filter(row => row.success && Number.isFinite(row.latencyMs)).map(row => row.latencyMs)
  const categories = {}
  for (const row of rows) {
    const bucket = categories[row.category] ??= { cases: 0, passed: 0, missing: 0 }
    bucket.cases += 1
    if (row.success) bucket.passed += 1
    if (row.missing) bucket.missing += 1
  }
  for (const bucket of Object.values(categories)) bucket.passRate = bucket.cases === 0 ? 0 : bucket.passed / bucket.cases

  const routeSources = {
    provider: rows.filter(row => row.routeSource === 'provider').length,
    semanticCache: rows.filter(row => row.routeSource === 'semantic-cache').length,
    evidenceCache: rows.filter(row => row.routeSource === 'evidence-cache').length,
    unknown: rows.filter(row => !row.routeReported && !row.missing).length,
  }
  const routeDecisions = routeDecisionBreakdown(rows)

  return {
    cases: rows.length,
    missing: rows.filter(row => row.missing).length,
    routingSuccessRate: weighted(row => row.toolCalled),
    assertionPassRate: weighted(row => row.assertionPass && !row.missing),
    taskSuccessRate: weighted(row => row.success),
    forbiddenHitCount: rows.reduce((sum, row) => sum + row.forbiddenHits, 0),
    traceCoverage: weighted(row => row.traceReported && !row.missing),
    routeCoverage: weighted(row => row.routeReported && !row.missing),
    routeDecisionCoverage: weighted(row => row.routeDecisionReported && !row.missing),
    routeTraceConsistencyRate: weightedAmong(
      row => row.routeReported && row.traceReported,
      row => row.routeTraceConsistent === true,
    ),
    routeDecisionConsistencyRate: weightedAmong(
      row => row.routeDecisionReported,
      row => row.routeDecisionConsistent === true,
    ),
    evidenceLayerEnabledRate: weightedAmong(
      row => row.routeDecisionReported,
      row => row.evidenceLayerEnabled === true,
    ),
    routeSources,
    routeTasks: routeDecisions.tasks,
    routeCacheModes: routeDecisions.cacheModes,
    evidenceLayer: routeDecisions.evidenceLayer,
    routeSourceOutcomes: routeSourceOutcomes(rows),
    tokenUsageCoverage: weighted(row => row.usageReported && !row.missing),
    zeroProviderReuseRate: weighted(row => row.zeroProviderReuse),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    totals: {
      calls: rows.reduce((sum, row) => sum + row.calls, 0),
      payloadBytes: rows.reduce((sum, row) => sum + row.payloadBytes, 0),
      cacheHits: rows.reduce((sum, row) => sum + row.cacheHits, 0),
      inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
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
