/** @vitest-environment node */

import { inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMemoryVisionCache } from '@ran-sh/dsh-vision'
import { understandImageTool } from '../src/tools/understand-image.ts'

const RUN = process.env['RUN_DETERMINISTIC_VISION_BENCHMARK'] === '1'

interface BenchmarkCase {
  id: string
  prompt: string
  images: string[]
  assertion?: { containsAll?: string[] }
}

interface LoadedRequestImage { bytes: Buffer }

function pngScanline(bytes: Buffer): { width: number; raw: Buffer } {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('deterministic fixture is not PNG')
  let offset = 8
  let width = 0
  const idat: Buffer[] = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') width = data.readUInt32BE(0)
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
    if (type === 'IEND') break
  }
  if (!Number.isSafeInteger(width) || width < 1 || idat.length === 0) throw new Error('PNG missing deterministic scanline')
  return { width, raw: inflateSync(Buffer.concat(idat)) }
}

export function decodeMarker(bytes: Buffer): string {
  const { width, raw } = pngScanline(bytes)
  const readBit = bit => raw[1 + bit * 2] < 128 ? 1 : 0
  let length = 0
  for (let bit = 0; bit < 16; bit += 1) length = (length << 1) | readBit(bit)
  if (length <= 0 || 16 + length * 8 > Math.floor(width / 2)) throw new Error('invalid deterministic marker length')
  const marker = Buffer.alloc(length)
  for (let byte = 0; byte < length; byte += 1) {
    for (let bit = 0; bit < 8; bit += 1) marker[byte] = (marker[byte] << 1) | readBit(16 + byte * 8 + bit)
  }
  return marker.toString('utf8')
}

function parseCases(path: string): BenchmarkCase[] {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as BenchmarkCase)
}

function routeTask(prompt: string, imageCount: number): 'ocr' | 'ui-review' | 'code' | 'document' | 'chart' | 'compare' | 'photo' {
  const normalized = prompt.toLowerCase()
  if (imageCount > 1 || normalized.includes('compare')) return 'compare'
  if (normalized.includes('ui') || normalized.includes('visible ui')) return 'ui-review'
  if (normalized.includes('code') || normalized.includes('terminal')) return 'code'
  if (normalized.includes('document') || normalized.includes('field')) return 'document'
  if (normalized.includes('chart')) return 'chart'
  if (normalized.includes('photo') || normalized.includes('object') || normalized.includes('people')) return 'photo'
  return 'ocr'
}

describe.skipIf(!RUN)('deterministic visual benchmark runtime', () => {
  it('executes the real understand_image tool and records observed telemetry', async () => {
    const casePath = process.env['DETERMINISTIC_VISION_BENCHMARK_CASES']
    const resultPath = process.env['DETERMINISTIC_VISION_BENCHMARK_RESULTS']
    const mode = process.env['DETERMINISTIC_VISION_BENCHMARK_MODE']
    expect(casePath).toBeDefined()
    expect(resultPath).toBeDefined()
    expect(mode === 'baseline' || mode === 'candidate').toBe(true)
    const cases = parseCases(casePath!)
    const evidenceCache = mode === 'candidate' ? createMemoryVisionCache({ ttlMs: 60_000, maxEntries: 256 }) : undefined
    const call = async (request: { images: LoadedRequestImage[]; prompt: string }) => {
      const markers = request.images.map(image => decodeMarker(Buffer.from(image.bytes)))
      const facts = request.images.length > 1
        ? markers.map((marker, index) => `Image ${index + 1}: ${marker}`)
        : [...new Set(markers.flatMap(marker => marker.split('|').filter(Boolean)))]
      const text = `${facts.join(' and ')} observed by deterministic local vision stub; no hidden detail was inferred.`
      const payloadBytes = request.images.reduce((sum, image) => sum + image.bytes.length, 0)
      return {
        text,
        provider: 'local-stub',
        model: 'local-stub-v1',
        usage: { inputTokens: Math.ceil((payloadBytes + request.prompt.length) / 4), outputTokens: text.length },
        trace: { providerCalls: 1, payloadBytes, cacheHits: 0, retries: 0, modelFallbacks: 0, providerFallbacks: 0, splits: 0 },
      }
    }
    const ctx = new Context()
    ctx.provide('vision', { call } as never)
    const tool = understandImageTool(ctx, () => 'describe the image', () => ({ maxBytes: 1024 * 1024, allowPrivateNetwork: false }), evidenceCache)
    const caseDirectory = casePath!.replace(/[\\/][^\\/]*$/, '')
    const output: string[] = []
    const exec = { signal: new AbortController().signal } as never

    for (const testCase of cases) {
      const refs = testCase.images.map(ref => /^[A-Za-z]:[\\/]|^\//.test(ref) ? ref : `${caseDirectory}/${ref}`)
      try {
        const result = await tool.execute({
          ...(refs.length === 1 ? { image: refs[0] } : { images: refs }),
          prompt: testCase.prompt,
        }, exec)
        const trace = result.trace
        const payloadBytes = trace?.payloadBytes ?? 0
        const latencyMs = trace?.providerCalls === 0 ? 2 : 5 + Math.ceil(payloadBytes / 10_000)
        output.push(JSON.stringify({
          id: testCase.id,
          mode: `deterministic-local-stub-${mode}`,
          answer: result.text,
          toolCalled: true,
          latencyMs,
          provider: result.provider,
          model: result.model,
          route: result.route,
          // A layered hit has no provider usage object; record explicit zero
          // provider tokens so scorer coverage distinguishes it from missing
          // telemetry while preserving the cache trace's zero-call truth.
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          ...(trace === undefined ? {} : trace),
          error: null,
        }))
      } catch (error) {
        output.push(JSON.stringify({ id: testCase.id, mode: `deterministic-local-stub-${mode}`, answer: '', toolCalled: true, latencyMs: 0, error: error instanceof Error ? error.name : 'UNKNOWN_ERROR' }))
      }
    }
    writeFileSync(resultPath!, `${output.join('\n')}\n`, 'utf8')
    expect(output).toHaveLength(cases.length)
  }, 10 * 60 * 1000)
})

describe('deterministic compare fixture ordering', () => {
  it('keeps distinct facts in the supplied Image 1/Image 2 pixel order', () => {
    const fixtureRoot = resolve(import.meta.dirname, '../../../benchmarks/vision/fixtures/generated')
    const imageOne = decodeMarker(readFileSync(resolve(fixtureRoot, 'compare-a-01.png')))
    const imageTwo = decodeMarker(readFileSync(resolve(fixtureRoot, 'compare-b-01.png')))
    expect(imageOne).toBe('COMPARE-FACT-01')
    expect(imageTwo).toBe('COMPARE-FACT-02')
    expect(imageOne).not.toBe(imageTwo)
  })
})
