/**
 * Execute the current long-PNG preprocessing geometry beside the historical
 * 3072-long-edge policy on the committed deterministic fixtures.
 *
 * This is benchmark-only code. It decodes the repository-owned grayscale PNG,
 * performs a nearest-neighbour resize, re-encodes a valid PNG, and measures a
 * deterministic processing-unit count plus observable output/readability
 * facts. It does not change the browser's production preprocessing policy.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, '..')
const FIXTURE_ROOT = join(REPO_ROOT, 'benchmarks', 'vision', 'fixtures', 'generated')
const REPORT_PATH = join(REPO_ROOT, 'benchmarks', 'vision', 'reports', '015-long-image-preprocess.json')
const PNG_MAX_PIXELS = 10 * 1024 * 1024
const CURRENT_LONG_EDGE = 8192
const HISTORICAL_LONG_EDGE = 3072

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBytes, data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(payload), 0)
  return Buffer.concat([length, payload, crc])
}

function decodeGrayPng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('fixture is not a PNG')
  let offset = 8
  let width
  let height
  let idat = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 0) throw new Error('comparison requires 8-bit grayscale fixtures')
    }
    if (type === 'IDAT') idat.push(data)
    offset += length + 12
    if (type === 'IEND') break
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || idat.length === 0) throw new Error('PNG missing dimensions or pixels')
  const decoded = inflateSync(Buffer.concat(idat))
  const rowBytes = width + 1
  if (decoded.length !== rowBytes * height) throw new Error('unexpected grayscale scanline size')
  for (let y = 0; y < height; y += 1) {
    if (decoded[y * rowBytes] !== 0) throw new Error('comparison fixtures must use filter type 0')
  }
  const pixels = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) decoded.copy(pixels, y * width, y * rowBytes + 1, (y + 1) * rowBytes)
  return { width, height, pixels }
}

function encodeGrayPng(width, height, pixels) {
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 0
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function targetDimensions(width, height, maxEdge, maxPixels) {
  const edgeScale = Math.min(1, maxEdge / Math.max(width, height))
  const pixelScale = maxPixels === undefined ? 1 : Math.min(1, Math.sqrt(maxPixels / (width * height)))
  const scale = Math.min(edgeScale, pixelScale)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function resizeNearest(source, target) {
  const output = Buffer.alloc(target.width * target.height)
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / target.height))
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / target.width))
      output[y * target.width + x] = source.pixels[sourceY * source.width + sourceX]
    }
  }
  return output
}

function readabilityAndOrder(image) {
  const rows = []
  let contrastTotal = 0
  let contrastSamples = 0
  let darkPixels = 0
  for (let y = 0; y < image.height; y += 1) {
    let rowSum = 0
    let rowContrast = 0
    for (let x = 0; x < image.width; x += 1) {
      const value = image.pixels[y * image.width + x]
      rowSum += value
      if (value < 128) darkPixels += 1
      if (x > 0) {
        rowContrast += Math.abs(value - image.pixels[y * image.width + x - 1])
        contrastTotal += Math.abs(value - image.pixels[y * image.width + x - 1])
        contrastSamples += 1
      }
    }
    if (y % Math.max(1, Math.floor(image.height / 64)) === 0) rows.push(rowSum + rowContrast)
  }
  const rowOrderHash = createHash('sha256').update(Buffer.from(rows.join(','))).digest('hex')
  return {
    darkPixelRatio: darkPixels / (image.width * image.height),
    horizontalContrast: contrastSamples === 0 ? 0 : contrastTotal / contrastSamples,
    rowOrderHash,
    sampledRows: rows.length,
    distinctSampledRows: new Set(rows).size,
  }
}

function executePolicy(source, maxEdge, maxPixels) {
  const target = targetDimensions(source.width, source.height, maxEdge, maxPixels)
  const pixels = resizeNearest(source, target)
  const output = encodeGrayPng(target.width, target.height, pixels)
  const readability = readabilityAndOrder({ ...target, pixels })
  return {
    dimensions: target,
    outputBytes: output.length,
    processingUnits: source.width * source.height + target.width * target.height,
    readability,
    outputSha256: createHash('sha256').update(output).digest('hex'),
  }
}

function compareFixture(name) {
  const bytes = readFileSync(join(FIXTURE_ROOT, name))
  const source = decodeGrayPng(bytes)
  const current = executePolicy(source, CURRENT_LONG_EDGE, PNG_MAX_PIXELS)
  const historical = executePolicy(source, HISTORICAL_LONG_EDGE)
  if (current.dimensions.width <= historical.dimensions.width) throw new Error(`${name}: current width did not preserve more text resolution`)
  if (current.readability.darkPixelRatio < historical.readability.darkPixelRatio * 0.8) throw new Error(`${name}: current readability density regressed`)
  if (current.readability.sampledRows < 2 || current.readability.distinctSampledRows < 2) throw new Error(`${name}: row order evidence is degenerate`)
  if (historical.readability.sampledRows < 2 || historical.readability.distinctSampledRows < 2) throw new Error(`${name}: historical row order evidence is degenerate`)
  return {
    fixture: `benchmarks/vision/fixtures/generated/${name}`,
    source: { width: source.width, height: source.height, inputBytes: bytes.length },
    currentAspectPixelAware: current,
    historical3072LongEdge: historical,
    assertions: {
      currentPreservesMoreHorizontalResolution: true,
      currentReadabilityAtLeast80PercentOfHistorical: true,
      currentRowOrderEvidence: true,
      historicalRowOrderEvidence: true,
    },
  }
}

export function compareLongImagePreprocess() {
  const comparisons = ['long-1440x10000.png', 'long-1440x20000.png'].map(compareFixture)
  const report = {
    schemaVersion: 1,
    benchmarkOnly: true,
    policy: {
      current: { maxEdge: CURRENT_LONG_EDGE, maxPixels: PNG_MAX_PIXELS, resize: 'nearest-neighbour' },
      historical: { maxEdge: HISTORICAL_LONG_EDGE, maxPixels: null, resize: 'nearest-neighbour' },
    },
    comparisons,
  }
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const report = compareLongImagePreprocess()
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  }
}
