/**
 * Generate and execute the repository-safe Batch 015 visual benchmark.
 *
 * The corpus is offline and deterministic. Each generated PNG contains a
 * small, non-rendered marker in its first scanline. The deterministic runner
 * decodes that marker from the bytes received by understand_image, so the
 * committed results are produced by the real tool/cache path rather than by
 * copying assertions into synthetic telemetry.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseJsonl, scoreBenchmark } from './vision-benchmark-score.mjs'
import { compareBenchmarkRuns } from './vision-benchmark-compare.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(ROOT, '..')
const BENCHMARK_DIR = join(REPO_ROOT, 'benchmarks', 'vision')
const FIXTURE_DIR = join(BENCHMARK_DIR, 'fixtures', 'generated')
const REPORT_DIR = join(BENCHMARK_DIR, 'reports')

const CATEGORY_SPECS = [
  { category: 'ui-review', prefix: 'ui', count: 20, task: 'ui-review', fixturePrefix: 'ui', width: 640, height: 360, seed: 11, broad: 'Capture all visible UI text, controls, layout relationships, and clipping evidence.', narrow: 'What exact visible UI fact should be checked next?', fact: index => `UI-FACT-${String(index).padStart(2, '0')}` },
  { category: 'ide-terminal', prefix: 'ide', count: 20, task: 'code', fixturePrefix: 'ide-terminal', width: 640, height: 360, seed: 13, broad: 'Review the visible IDE and terminal code, commands, filenames, and line numbers exactly.', narrow: 'Which exact terminal or code fact is visible?', fact: index => `IDE-FACT-${String(index).padStart(2, '0')}` },
  { category: 'document-ocr', prefix: 'document', count: 20, task: 'document', fixturePrefix: 'document', width: 640, height: 900, seed: 17, broad: 'Review this document: capture headings, fields, values, tables, and reading-order facts.', narrow: 'Which exact document field is visibly present?', fact: index => `DOC-FACT-${String(index).padStart(2, '0')}` },
  { category: 'chart', prefix: 'chart', count: 15, task: 'chart', fixturePrefix: 'chart', width: 800, height: 500, seed: 19, broad: 'Capture chart title, axes, units, legend, visible values, extrema, and trends.', narrow: 'Which exact chart value or label is visible?', fact: index => `CHART-FACT-${String(index).padStart(2, '0')}` },
  { category: 'photo-general', prefix: 'photo', count: 15, task: 'photo', fixturePrefix: 'photo', width: 640, height: 480, seed: 23, broad: 'Describe the visible people, objects, scene, and spatial relationships without guessing.', narrow: 'Which exact visible object or relationship answers the question?', fact: index => `PHOTO-FACT-${String(index).padStart(2, '0')}` },
  { category: 'compare-diff', prefix: 'compare', count: 10, task: 'compare', fixturePrefix: 'compare', width: 640, height: 480, seed: 29, compare: true, broad: 'Compare the supplied images in order and record additions, removals, modifications, and unchanged facts.', narrow: 'Which exact change distinguishes Image 1 from Image 2?', fact: index => `COMPARE-FACT-${String(index).padStart(2, '0')}` },
]

const LONG_FIXTURES = [
  { name: 'long-1440x10000.png', width: 1440, height: 10_000, seed: 17, marker: 'UI-FACT-19|UI-FACT-20' },
  { name: 'long-1440x20000.png', width: 1440, height: 20_000, seed: 29, marker: 'DOC-FACT-19|DOC-FACT-20' },
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

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
}

function drawVisibleText(raw, width, height, text) {
  const scale = 2
  const startX = 16
  const startY = 16
  for (const [charIndex, character] of [...text].entries()) {
    const glyph = FONT[character] ?? FONT[character.toUpperCase()]
    if (glyph === undefined) continue
    const originX = startX + charIndex * 12
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== '1') continue
        for (let dy = 0; dy < scale; dy += 1) {
          const y = startY + row * scale + dy
          if (y >= height) continue
          for (let dx = 0; dx < scale; dx += 1) {
            const x = originX + column * scale + dx
            if (x < width) raw[y * (width + 1) + 1 + x] = 20
          }
        }
      }
    }
  }
}

/** Encode visible-safe grayscale pixels plus a marker carried by pixel bytes. */
function grayscalePng(width, height, seed, marker) {
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

  // Two pixels encode each bit. A 16-bit length header makes decoding
  // unambiguous while leaving the marker below the first scanline's visual
  // noise floor for these synthetic fixtures.
  const markerBytes = Buffer.from(marker, 'utf8')
  const bitCount = 16 + markerBytes.length * 8
  if (bitCount * 2 > width) throw new Error(`marker is too wide for ${width}px fixture: ${marker}`)
  const setBit = (bitIndex, value) => {
    const x = bitIndex * 2
    raw[1 + x] = value ? 32 : 224
    raw[1 + x + 1] = raw[1 + x]
  }
  for (let bit = 0; bit < 16; bit += 1) setBit(bit, (markerBytes.length >>> (15 - bit)) & 1)
  for (let byte = 0; byte < markerBytes.length; byte += 1) {
    for (let bit = 0; bit < 8; bit += 1) setBit(16 + byte * 8 + bit, (markerBytes[byte] >>> (7 - bit)) & 1)
  }
  drawVisibleText(raw, width, height, marker.replaceAll('|', ' '))

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 0
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function writeFixture(name, width, height, seed, marker) {
  const path = join(FIXTURE_DIR, name)
  const bytes = grayscalePng(width, height, seed, marker)
  writeFileSync(path, bytes)
  return {
    path: `fixtures/generated/${name}`,
    width,
    height,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function makeCases() {
  const cases = []
  const fixtureRefs = new Set()
  const fixturePlans = []
  const planned = new Set()

  for (const spec of CATEGORY_SPECS) {
    for (let index = 1; index <= spec.count; index += 1) {
      const ordinal = String(index).padStart(2, '0')
      const fixtureOrdinal = String(Math.ceil(index / 2)).padStart(2, '0')
      const followup = index % 2 === 0
      const fact = spec.fact(index)
      const pairEnd = Math.min(spec.count, index + (index % 2 === 1 ? 1 : 0))
      const pairStart = index - (index % 2 === 0 ? 1 : 0)
      const marker = `${spec.fact(pairStart)}|${spec.fact(pairEnd)}`
      const imageNames = spec.compare
        ? [`${spec.fixturePrefix}-a-${fixtureOrdinal}.png`, `${spec.fixturePrefix}-b-${fixtureOrdinal}.png`]
        : [`${spec.fixturePrefix}-${fixtureOrdinal}.png`]
      const images = imageNames.map(name => `fixtures/generated/${name}`)
      images.forEach(image => fixtureRefs.add(image))
      imageNames.forEach((name, imageIndex) => {
        if (planned.has(name)) return
        planned.add(name)
        fixturePlans.push({
          name,
          width: spec.width,
          height: spec.height,
          seed: spec.seed + Math.ceil(index / 2) * 3 + imageIndex,
          // Compare fixtures carry one fact per ordered image. Other fixture
          // pairs carry both facts in a reusable broad-evidence marker.
          marker: spec.compare ? spec.fact(pairStart + imageIndex) : marker,
        })
      })
      cases.push({
        id: `${spec.prefix}-${ordinal}-${followup ? 'followup' : 'broad'}`,
        category: spec.category,
        prompt: `${followup ? spec.narrow : spec.broad} Fixture fact ${fact}.`,
        images,
        weight: 1,
        assertion: { containsAll: [fact], excludes: [`NOT-VISIBLE-${spec.prefix.toUpperCase()}-${ordinal}`] },
      })
    }
  }

  const replaceLong = (id, path) => {
    const testCase = cases.find(row => row.id === id)
    if (testCase === undefined) throw new Error(`missing long screenshot case ${id}`)
    testCase.images = [path]
    fixtureRefs.delete('fixtures/generated/ui-10.png')
    fixtureRefs.delete('fixtures/generated/document-10.png')
    fixtureRefs.add(path)
  }
  replaceLong('ui-19-broad', 'fixtures/generated/long-1440x10000.png')
  replaceLong('ui-20-followup', 'fixtures/generated/long-1440x10000.png')
  replaceLong('document-19-broad', 'fixtures/generated/long-1440x20000.png')
  replaceLong('document-20-followup', 'fixtures/generated/long-1440x20000.png')

  for (const fixture of LONG_FIXTURES) fixturePlans.push(fixture)
  const activeFixturePlans = fixturePlans.filter(plan => fixtureRefs.has(`fixtures/generated/${plan.name}`))
  return { cases, fixtureRefs: [...fixtureRefs].sort(), fixturePlans: activeFixturePlans }
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function cleanupOwnedFixtures(expectedPaths) {
  const manifestPath = join(BENCHMARK_DIR, 'corpus-manifest.json')
  if (!existsSync(manifestPath)) return
  try {
    const previous = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const entry of previous.fixtureMetadata ?? []) {
      const relative = entry?.path
      if (typeof relative !== 'string' || !relative.startsWith('fixtures/generated/')) continue
      if (expectedPaths.has(relative)) continue
      const name = relative.slice('fixtures/generated/'.length)
      if (name.includes('/') || name.includes('\\') || name.length === 0) continue
      const path = join(FIXTURE_DIR, name)
      if (existsSync(path)) unlinkSync(path)
    }
  } catch {
    // A malformed old manifest is never a reason to delete arbitrary files.
  }
}

function runDeterministicBenchmark() {
  const runner = join(REPO_ROOT, 'scripts', 'run-deterministic-vision-benchmark.mjs')
  const result = spawnSync(process.execPath, [runner], { cwd: REPO_ROOT, stdio: 'inherit' })
  if ((result.status ?? 1) !== 0) throw new Error(`deterministic benchmark runner failed with status ${result.status ?? 1}`)
}

export function generateVisionBenchmarkCorpus() {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  mkdirSync(REPORT_DIR, { recursive: true })
  const { cases, fixtureRefs, fixturePlans } = makeCases()
  const expectedPaths = new Set(fixturePlans.map(plan => `fixtures/generated/${plan.name}`))
  cleanupOwnedFixtures(expectedPaths)
  const fixtureMetadata = fixturePlans.map(plan => writeFixture(plan.name, plan.width, plan.height, plan.seed, plan.marker))

  const corpusManifest = {
    schemaVersion: 1,
    generator: 'scripts/generate-vision-benchmark-corpus.mjs',
    deterministic: true,
    networkRequired: false,
    provider: 'deterministic-local-stub',
    qualityScope: 'deterministic visible-fact/routing/cache/telemetry benchmark; not a hosted-provider OCR or visual-model quality claim',
    totalCases: cases.length,
    categoryCounts: Object.fromEntries(CATEGORY_SPECS.map(spec => [spec.category, spec.count])),
    fixtureRefs,
    fixtureMetadata,
    pairPolicy: 'Odd cases are broad reusable evidence; even cases ask a materially different follow-up over the same ordered fixture set.',
    longScreenshotCases: ['ui-19-broad', 'ui-20-followup', 'document-19-broad', 'document-20-followup'],
  }
  writeJsonl(join(BENCHMARK_DIR, 'cases.jsonl'), cases)
  writeJson(join(BENCHMARK_DIR, 'corpus-manifest.json'), corpusManifest)
  runDeterministicBenchmark()

  const parsedCases = parseJsonl(readFileSync(join(BENCHMARK_DIR, 'cases.jsonl'), 'utf8'))
  const parsedBaseline = parseJsonl(readFileSync(join(BENCHMARK_DIR, 'results.baseline.jsonl'), 'utf8'))
  const parsedCandidate = parseJsonl(readFileSync(join(BENCHMARK_DIR, 'results.candidate.jsonl'), 'utf8'))
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
  return { cases: parsedCases, baseline: parsedBaseline, candidate: parsedCandidate, baselineScore, candidateScore, comparison, corpusManifest }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
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
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  }
}
