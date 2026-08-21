/**
 * Baseline-vs-candidate regression gate for the vision benchmark.
 *
 * The gate is intentionally conservative: quality regressions are tightly
 * bounded, while latency/cost get modest headroom for noisy hosted providers.
 * It performs no provider I/O; both result files must come from the same
 * frozen case corpus and comparable provider settings.
 */

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseJsonl, scoreBenchmark } from './vision-benchmark-score.mjs'

export const DEFAULT_BENCHMARK_THRESHOLDS = Object.freeze({
  maxRoutingRegression: 0.01,
  maxTaskSuccessRegression: 0.02,
  maxForbiddenHitIncrease: 0,
  maxTraceCoverageRegression: 0.10,
  maxRouteCoverageRegression: 0.10,
  maxTokenCoverageRegression: 0.10,
  minComparableCoverage: 0.80,
  maxP95LatencyRatio: 1.30,
  p95LatencyAbsoluteAllowanceMs: 250,
  maxCallsRatio: 1.15,
  maxPayloadBytesRatio: 1.20,
  maxInputTokensRatio: 1.20,
  maxOutputTokensRatio: 1.20,
})

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function upperBound(baseline, ratio, allowance = 0) {
  return Math.max(baseline * ratio, baseline + allowance)
}

function checkLower(name, baseline, candidate, allowedRegression) {
  const limit = baseline - allowedRegression
  return { name, pass: candidate >= limit, baseline, candidate, limit, direction: 'min' }
}

function checkUpper(name, baseline, candidate, limit) {
  return { name, pass: candidate <= limit, baseline, candidate, limit, direction: 'max' }
}

function coverageRatioCheck(
  name,
  baselineValue,
  candidateValue,
  ratio,
  baselineCoverage,
  candidateCoverage,
  minCoverage,
) {
  if (baselineCoverage < minCoverage || candidateCoverage < minCoverage) {
    return {
      name,
      pass: true,
      skipped: true,
      reason: `telemetry coverage below comparable threshold ${minCoverage}`,
      baselineCoverage,
      candidateCoverage,
    }
  }
  const baseline = finite(baselineValue)
  const candidate = finite(candidateValue)
  if (baseline === undefined || candidate === undefined || (baseline === 0 && candidate === 0)) {
    return { name, pass: true, skipped: true, reason: 'metric unavailable or both zero' }
  }
  const limit = baseline === 0 ? 0 : baseline * ratio
  return checkUpper(name, baseline, candidate, limit)
}

/** Compare two already-scored benchmark summaries. */
export function compareBenchmarkScores(baseline, candidate, thresholds = {}) {
  const t = { ...DEFAULT_BENCHMARK_THRESHOLDS, ...thresholds }
  if (baseline.cases !== candidate.cases) {
    return {
      pass: false,
      checks: [{
        name: 'same-case-count', pass: false,
        baseline: baseline.cases, candidate: candidate.cases,
        reason: 'baseline and candidate must use the same frozen corpus',
      }],
    }
  }

  const baselineTraceCoverage = finite(baseline.traceCoverage) ?? 0
  const candidateTraceCoverage = finite(candidate.traceCoverage) ?? 0
  const baselineRouteCoverage = finite(baseline.routeCoverage) ?? 0
  const candidateRouteCoverage = finite(candidate.routeCoverage) ?? 0
  const baselineTokenCoverage = finite(baseline.tokenUsageCoverage) ?? 0
  const candidateTokenCoverage = finite(candidate.tokenUsageCoverage) ?? 0

  const checks = [
    checkUpper('missing-results', baseline.missing, candidate.missing, baseline.missing),
    checkLower('routing-success-rate', baseline.routingSuccessRate, candidate.routingSuccessRate, t.maxRoutingRegression),
    checkLower('task-success-rate', baseline.taskSuccessRate, candidate.taskSuccessRate, t.maxTaskSuccessRegression),
    checkUpper('forbidden-hit-count', baseline.forbiddenHitCount, candidate.forbiddenHitCount, baseline.forbiddenHitCount + t.maxForbiddenHitIncrease),
    checkLower('trace-coverage', baselineTraceCoverage, candidateTraceCoverage, t.maxTraceCoverageRegression),
    checkLower('route-coverage', baselineRouteCoverage, candidateRouteCoverage, t.maxRouteCoverageRegression),
    checkLower('token-usage-coverage', baselineTokenCoverage, candidateTokenCoverage, t.maxTokenCoverageRegression),
  ]

  const baselineP95 = finite(baseline.latencyMs?.p95)
  const candidateP95 = finite(candidate.latencyMs?.p95)
  if (baselineP95 !== undefined && candidateP95 !== undefined) {
    checks.push(checkUpper(
      'p95-latency-ms',
      baselineP95,
      candidateP95,
      upperBound(baselineP95, t.maxP95LatencyRatio, t.p95LatencyAbsoluteAllowanceMs),
    ))
  } else {
    checks.push({ name: 'p95-latency-ms', pass: true, skipped: true, reason: 'latency unavailable' })
  }

  checks.push(
    coverageRatioCheck(
      'provider-calls', baseline.totals?.calls, candidate.totals?.calls, t.maxCallsRatio,
      baselineTraceCoverage, candidateTraceCoverage, t.minComparableCoverage,
    ),
    coverageRatioCheck(
      'payload-bytes', baseline.totals?.payloadBytes, candidate.totals?.payloadBytes, t.maxPayloadBytesRatio,
      baselineTraceCoverage, candidateTraceCoverage, t.minComparableCoverage,
    ),
    coverageRatioCheck(
      'input-tokens', baseline.totals?.inputTokens, candidate.totals?.inputTokens, t.maxInputTokensRatio,
      baselineTokenCoverage, candidateTokenCoverage, t.minComparableCoverage,
    ),
    coverageRatioCheck(
      'output-tokens', baseline.totals?.outputTokens, candidate.totals?.outputTokens, t.maxOutputTokensRatio,
      baselineTokenCoverage, candidateTokenCoverage, t.minComparableCoverage,
    ),
  )

  return {
    pass: checks.every(check => check.pass),
    checks,
    summary: {
      baselineTaskSuccessRate: baseline.taskSuccessRate,
      candidateTaskSuccessRate: candidate.taskSuccessRate,
      baselineTraceCoverage,
      candidateTraceCoverage,
      baselineRouteCoverage,
      candidateRouteCoverage,
      baselineRouteSources: baseline.routeSources ?? {},
      candidateRouteSources: candidate.routeSources ?? {},
      baselineTokenUsageCoverage: baselineTokenCoverage,
      candidateTokenUsageCoverage: candidateTokenCoverage,
      baselineZeroProviderReuseRate: baseline.zeroProviderReuseRate ?? 0,
      candidateZeroProviderReuseRate: candidate.zeroProviderReuseRate ?? 0,
      baselineCalls: baseline.totals?.calls ?? 0,
      candidateCalls: candidate.totals?.calls ?? 0,
      baselineInputTokens: baseline.totals?.inputTokens ?? 0,
      candidateInputTokens: candidate.totals?.inputTokens ?? 0,
    },
  }
}

/** Score the same case corpus twice, then run the regression gate. */
export function compareBenchmarkRuns(cases, baselineResults, candidateResults, thresholds = {}) {
  const baseline = scoreBenchmark(cases, baselineResults)
  const candidate = scoreBenchmark(cases, candidateResults)
  return { baseline, candidate, comparison: compareBenchmarkScores(baseline, candidate, thresholds) }
}

async function main(argv) {
  if (argv.length < 3) {
    console.error('usage: node scripts/vision-benchmark-compare.mjs <cases.jsonl> <baseline-results.jsonl> <candidate-results.jsonl>')
    process.exitCode = 2
    return
  }
  const [casePath, baselinePath, candidatePath] = argv
  const [caseText, baselineText, candidateText] = await Promise.all([
    readFile(casePath, 'utf8'),
    readFile(baselinePath, 'utf8'),
    readFile(candidatePath, 'utf8'),
  ])
  const report = compareBenchmarkRuns(
    parseJsonl(caseText),
    parseJsonl(baselineText),
    parseJsonl(candidateText),
  )
  console.log(JSON.stringify(report, null, 2))
  if (!report.comparison.pass) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main(process.argv.slice(2))
}
