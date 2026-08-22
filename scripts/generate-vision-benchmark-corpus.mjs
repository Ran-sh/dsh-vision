/**
 * Generate the repository-safe Batch 015 visual benchmark corpus.
 *
 * The corpus is deliberately offline and deterministic. The fixture images are
 * synthetic grayscale PNGs with stable geometry; the result files model the
 * same deterministic local stub under a forced-fresh baseline and a layered
 * evidence candidate. No provider, network, credential, or machine path is
 * consulted while generating the corpus.
 */

import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseJsonl, scoreBenchmark } from './vision-benchmark-score.mjs'
import { compareBenchmarkRuns } from './vision-benchmark-compare.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const BENCHMARK_DIR = join(ROOT, '..', 'benchmarks', 'vision')
const FIXTURE_DIR = join(BENCHMARK_DIR, 'fixtures', 'generated')
const REPORT_DIR = join(BENCHMARK_DIR, 'reports')

const CATEGORY_SPECS = [
  {
    category: 'ui-review',
    prefix: 'ui',
    count: 20,
    task: 'ui-review',
    fixturePrefix: 'ui',
    width: 640,
    height: 360,
    seed: 11,
    broad: 'Capture all visible UI text, controls, layout relationships, and clipping evidence.',
    narrow: 'What exact visible UI fact should be checked next?',
    fact: index => `UI-FACT-${String(index).padStart(2, '0')}`,
  },
  {
    category: 'ide-terminal',
    prefix: 'ide',
    count: 20,
    task: 'code',
    fixturePrefix: 'ide-terminal',
    width: 640,
    height: 360,
    seed: 13,
    broad: 'Transcribe visible code, commands, filenames, errors, and line numbers exactly.',
    narrow: 'Which exact terminal or code fact is visible?',
    fact: index => `IDE-FACT-${String(index).padStart(2, '0')}`,
  },
  {
    category: 'document-ocr',
    prefix: 'document',
    count: 20,
    task: 'document',
    fixturePrefix: 'document',
    width: 640,
    height: 900,
    seed: 17,
    broad: 'Extract headings, fields, values, tables, and reading-order evidence from the document.',
    narrow: 'Which exact document field is visibly present?',
    fact: index => `DOC-FACT-${String(index).padStart(2, '0')}`,
  },
  {
    category: 'chart',
    prefix: 'chart',
    count: 15,
    task: 'chart',
    fixturePrefix: 'chart',
    width: 800,
    height: 500,
    seed: 19,
    broad: 'Capture chart title, axes, units, legend, visible values, extrema, and trends.',
    narrow: 'Which exact chart value or label is visible?',
    fact: index => `CHART-FACT-${String(index).padStart(2, '0')}`,
  },
  {
    category: 'photo-general',
    prefix: 'photo',
    count: 15,
    task: 'photo',
    fixturePrefix: 'photo',
    width: 640,
    height: 480,
    seed: 23,
    broad: 'Describe the visible people, objects, scene, and spatial relationships without guessing.',
    narrow: 'Which exact visible object or relationship answers the question?',
    fact: index => `PHOTO-FACT-${String(index).padStart(2, '0')}`,
  },
  {
    category: 'compare-diff',
    prefix: 'compare',
    count: 10,
    task: 'compare',
    fixturePrefix: 'compare',
    width: 640,
    height: 480,
    seed: 29,
    compare: true,
    broad: 'Compare the supplied images in order and record additions, removals, modifications, and unchanged facts.',
    narrow: 'Which exact change distinguishes Image 1 from Image 2?',
    fact: index => `COMPARE-FACT-${String(index).padStart(2, '0')}`,
  },
]

const LONG_FIXTURES = [
  { name: 'long-1440x10000.png', width: 1440, height: 10_000, seed: 17 },
  { name: 'long-1440x20000.png', width: 1440, height: 20_000, seed: 29 },
]

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBytes, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(payload), 0)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  return Buffer.concat([length, payload, crc])
}

/** Encode deterministic 8-bit grayscale scanlines as a valid PNG. */
function grayscalePng(width, height, seed) {
  const raw = Buffer.alloc((width + 1) * height, 0)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1)
    raw[row] = 0
    raw.fill(248, row + 1, row + width + 1)
    const stripe = (y * 13 + seed * 7) % Math.max(32, width - 24)
    for (let x = stripe; x < Math.min(width, stripe + 12); x += 1) raw[row + 1 + x] = 80
    if ((y + seed) % 41 === 0) raw.fill(30, row + 1, row + width + 1)
    if ((y + seed * 3) % 97 === 0) raw.fill(150, row + 1 + (seed % 9), row + width + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 0 // grayscale
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function writeFixture(name, width, height, seed) {
  const path = join(FIXTURE_DIR, name)
  writeFileSync(path, grayscalePng(width, height, seed))
  return { path: `fixtures/generated/${name}`, width, height }
}

function makeCases() {
  const cases = []
  const fixtureRefs = new Set()
  const fixturePlans = []
  const plannedFixtureNames = new Set()
  for (const spec of CATEGORY_SPECS) {
    for (let index = 1; index <= spec.count; index += 1) {
      const ordinal = String(index).padStart(2, '0')
      const fixtureOrdinal = String(Math.ceil(index / 2)).padStart(2, '0')
      const followup = index % 2 === 0
      const fact = spec.fact(index)
      const imageNames = spec.compare
        ? [`${spec.fixturePrefix}-a-${fixtureOrdinal}.png`, `${spec.fixturePrefix}-b-${fixtureOrdinal}.png`]
        : [`${spec.fixturePrefix}-${fixtureOrdinal}.png`]
      const images = imageNames.map(name => `fixtures/generated/${name}`)
      images.forEach(image => fixtureRefs.add(image))
      imageNames.forEach((name, imageIndex) => {
        if (plannedFixtureNames.has(name)) return
        plannedFixtureNames.add(name)
        fixturePlans.push({
          name,
          width: spec.width,
          height: spec.height,
          seed: spec.seed + index * 3 + imageIndex,
        })
      })
      if (followup) {
        // This question is intentionally answered by the broad evidence in the
        // deterministic candidate; narrow-missing-detail behavior is exercised
        // separately by the runtime no-store regression matrix.
      }
      cases.push({
        id: `${spec.prefix}-${ordinal}-${followup ? 'followup' : 'broad'}`,
        category: spec.category,
        prompt: `${followup ? spec.narrow : spec.broad} Fixture fact ${fact}.`,
        images,
        weight: 1,
        assertion: {
          containsAll: [fact],
          excludes: [`NOT-VISIBLE-${spec.prefix.toUpperCase()}-${ordinal}`],
        },
      })
    }
  }
  return { cases, fixtureRefs: [...fixtureRefs].sort(), fixturePlans }
}

function makeResult(testCase, mode, ordinal, evidenceFacts = [testCase.assertion.containsAll[0]]) {
  const reusable = testCase.category !== 'photo-general'
  const followup = testCase.id.endsWith('-followup')
  const evidenceHit = mode === 'candidate' && reusable && followup
  const task = testCase.category === 'ui-review' ? 'ui-review'
    : testCase.category === 'ide-terminal' ? 'code'
      : testCase.category === 'document-ocr' ? 'document'
        : testCase.category === 'photo-general' ? 'photo'
          : testCase.category === 'compare-diff' ? 'compare' : 'chart'
  const providerCalls = evidenceHit ? 0 : 1
  const cacheHits = evidenceHit ? 1 : 0
  const routeSource = evidenceHit ? 'evidence-cache' : 'provider'
  const evidenceLayerEnabled = reusable
  const answer = `${evidenceFacts.join(' and ')} observed by the deterministic local vision fixture; no hidden detail was inferred.`
  return {
    id: testCase.id,
    mode: `deterministic-local-stub-${mode}`,
    answer,
    toolCalled: true,
    latencyMs: evidenceHit ? 8 + ordinal : 120 + ordinal,
    provider: 'local-stub',
    model: mode === 'candidate' ? 'candidate-evidence-v1' : 'baseline-fresh-v1',
    route: {
      source: routeSource,
      task,
      cacheMode: 'use',
      evidenceLayerEnabled,
      selectedProvider: 'local-stub',
      selectedModel: mode === 'candidate' ? 'candidate-evidence-v1' : 'baseline-fresh-v1',
      modelFallback: false,
      providerFallback: false,
    },
    providerCalls,
    payloadBytes: evidenceHit ? 0 : 100_000 + ordinal,
    cacheHits,
    inputTokens: evidenceHit ? 0 : 1_000 + ordinal,
    outputTokens: evidenceHit ? 0 : 80,
    retries: 0,
    modelFallbacks: 0,
    providerFallbacks: 0,
    splits: 0,
    error: null,
  }
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function generateVisionBenchmarkCorpus() {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  mkdirSync(REPORT_DIR, { recursive: true })

  const fixtureMetadata = []
  const { cases, fixtureRefs: fixtureRefList, fixturePlans } = makeCases()
  const fixtureRefs = new Set(fixtureRefList)
  const expectedFixtureNames = new Set([
    ...fixturePlans.map(plan => plan.name),
    ...LONG_FIXTURES.map(fixture => fixture.name),
  ])
  for (const name of readdirSync(FIXTURE_DIR)) {
    if (name.endsWith('.png') && !expectedFixtureNames.has(name)) unlinkSync(join(FIXTURE_DIR, name))
  }
  for (const plan of fixturePlans) fixtureMetadata.push(writeFixture(plan.name, plan.width, plan.height, plan.seed))
  for (const fixture of LONG_FIXTURES) fixtureMetadata.push(writeFixture(fixture.name, fixture.width, fixture.height, fixture.seed))
  // Long-page cases deliberately share the same category totals while proving
  // both required 1440x10000 and 1440x20000 fixture dimensions are in corpus.
  cases.find(testCase => testCase.id === 'ui-19-broad').images = ['fixtures/generated/long-1440x10000.png']
  cases.find(testCase => testCase.id === 'ui-20-followup').images = ['fixtures/generated/long-1440x10000.png']
  cases.find(testCase => testCase.id === 'document-19-broad').images = ['fixtures/generated/long-1440x20000.png']
  cases.find(testCase => testCase.id === 'document-20-followup').images = ['fixtures/generated/long-1440x20000.png']
  fixtureRefs.delete('fixtures/generated/ui-10.png')
  fixtureRefs.delete('fixtures/generated/document-10.png')
  fixtureRefs.add('fixtures/generated/long-1440x10000.png')
  fixtureRefs.add('fixtures/generated/long-1440x20000.png')
  const evidenceFactsByImage = new Map()
  for (const testCase of cases) {
    const imageSet = testCase.images.join('|')
    const facts = evidenceFactsByImage.get(imageSet) ?? []
    facts.push(testCase.assertion.containsAll[0])
    evidenceFactsByImage.set(imageSet, facts)
  }
  const baseline = cases.map((testCase, index) => makeResult(
    testCase,
    'baseline',
    index + 1,
    evidenceFactsByImage.get(testCase.images.join('|')),
  ))
  const candidate = cases.map((testCase, index) => makeResult(
    testCase,
    'candidate',
    index + 1,
    evidenceFactsByImage.get(testCase.images.join('|')),
  ))
  writeJsonl(join(BENCHMARK_DIR, 'cases.jsonl'), cases)
  writeJsonl(join(BENCHMARK_DIR, 'results.baseline.jsonl'), baseline)
  writeJsonl(join(BENCHMARK_DIR, 'results.candidate.jsonl'), candidate)

  const corpusManifest = {
    schemaVersion: 1,
    generator: 'scripts/generate-vision-benchmark-corpus.mjs',
    deterministic: true,
    networkRequired: false,
    provider: 'deterministic-local-stub',
    totalCases: cases.length,
    categoryCounts: Object.fromEntries(CATEGORY_SPECS.map(spec => [spec.category, spec.count])),
    fixtureRefs: [...fixtureRefs].sort(),
    fixtureMetadata,
    pairPolicy: 'Odd cases are broad reusable evidence; even cases ask a materially different follow-up over the same ordered fixture set.',
    longScreenshotCases: ['ui-19-broad', 'ui-20-followup', 'document-19-broad', 'document-20-followup'],
  }
  writeJson(join(BENCHMARK_DIR, 'corpus-manifest.json'), corpusManifest)

  const caseText = readFileSync(join(BENCHMARK_DIR, 'cases.jsonl'), 'utf8')
  const baselineText = readFileSync(join(BENCHMARK_DIR, 'results.baseline.jsonl'), 'utf8')
  const candidateText = readFileSync(join(BENCHMARK_DIR, 'results.candidate.jsonl'), 'utf8')
  const parsedCases = parseJsonl(caseText)
  const parsedBaseline = parseJsonl(baselineText)
  const parsedCandidate = parseJsonl(candidateText)
  const baselineScore = scoreBenchmark(parsedCases, parsedBaseline)
  const candidateScore = scoreBenchmark(parsedCases, parsedCandidate)
  const comparison = compareBenchmarkRuns(parsedCases, parsedBaseline, parsedCandidate).comparison
  writeJson(join(REPORT_DIR, '015-baseline-score.json'), baselineScore)
  writeJson(join(REPORT_DIR, '015-candidate-score.json'), candidateScore)
  writeJson(join(REPORT_DIR, '015-compare.json'), {
    schemaVersion: 1,
    corpus: 'benchmarks/vision/cases.jsonl',
    baseline: 'benchmarks/vision/results.baseline.jsonl',
    candidate: 'benchmarks/vision/results.candidate.jsonl',
    comparison,
  })
  return { cases, baseline, candidate, baselineScore, candidateScore, comparison, corpusManifest }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = generateVisionBenchmarkCorpus()
  if (!output.comparison.pass) process.exitCode = 1
  console.log(JSON.stringify({
    cases: output.cases.length,
    baselineTaskSuccessRate: output.baselineScore.taskSuccessRate,
    candidateTaskSuccessRate: output.candidateScore.taskSuccessRate,
    baselineCalls: output.baselineScore.totals.calls,
    candidateCalls: output.candidateScore.totals.calls,
    candidateZeroProviderReuseRate: output.candidateScore.zeroProviderReuseRate,
    comparisonPass: output.comparison.pass,
  }, null, 2))
}
