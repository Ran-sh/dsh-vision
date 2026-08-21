/**
 * Gated real-provider benchmark executor.
 *
 * This is intentionally a tool-direct benchmark: it exercises the real
 * `understand_image -> ctx.vision -> image-mind adapter` path and records
 * quality/cost/recovery telemetry, but does not pretend to measure whether a
 * main chat model autonomously chose the tool. Agent tool-routing remains a
 * separate DSH integration dimension.
 *
 * Enabled only by scripts/run-vision-benchmark.mjs via RUN_VISION_BENCHMARK=1.
 * @vitest-environment node
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { VisionRuntime } from '@ran-sh/dsh-vision'
import { apply } from '../src/index.ts'
import { VISION_PROVIDER_CATALOG } from '../src/providers/catalog.ts'

const RUN = process.env['RUN_VISION_BENCHMARK'] === '1'

interface BenchmarkCase {
  id: string
  prompt: string
  images: string[]
  cache?: 'use' | 'refresh' | 'no-store'
}

interface ToolResult {
  text: string
  provider?: string
  model: string
  route?: {
    source: 'provider' | 'semantic-cache' | 'evidence-cache'
    requestedProvider?: string
    requestedModel?: string
    selectedProvider: string
    selectedModel: string
    modelFallback: boolean
    providerFallback: boolean
  }
  usage?: { inputTokens?: number; outputTokens?: number }
  trace?: {
    providerCalls: number
    payloadBytes: number
    cacheHits: number
    retries: number
    modelFallbacks: number
    providerFallbacks: number
    splits: number
  }
}

interface ToolLike {
  name: string
  execute(args: Record<string, unknown>, exec: { signal: AbortSignal }): Promise<ToolResult>
}

function credentialFromFile(name: string): string | undefined {
  const candidates = [
    join(homedir(), '.dsh', '.credentials.yaml'),
    join(homedir(), '.dsh', '.credentials.yml'),
  ]
  for (const path of candidates) {
    try {
      const text = readFileSync(path, 'utf8')
      const match = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'm').exec(text)
      if (match !== null) return match[1].trim()
    } catch {
      // Try the next credential document path.
    }
  }
  return undefined
}

function parseCases(text: string): BenchmarkCase[] {
  const rows: BenchmarkCase[] = []
  const seen = new Set<string>()
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      throw new Error(`benchmark cases: invalid JSONL line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const row = value as Partial<BenchmarkCase>
    if (typeof row.id !== 'string' || row.id.trim().length === 0) throw new Error(`benchmark cases: line ${index + 1} needs a non-empty id`)
    if (seen.has(row.id)) throw new Error(`benchmark cases: duplicate id ${JSON.stringify(row.id)}`)
    seen.add(row.id)
    if (typeof row.prompt !== 'string' || row.prompt.trim().length === 0) throw new Error(`benchmark case ${row.id}: prompt must be non-empty`)
    if (!Array.isArray(row.images) || row.images.length === 0 || row.images.some(image => typeof image !== 'string' || image.trim().length === 0)) {
      throw new Error(`benchmark case ${row.id}: images must be a non-empty string array`)
    }
    if (row.cache !== undefined && !['use', 'refresh', 'no-store'].includes(row.cache)) {
      throw new Error(`benchmark case ${row.id}: invalid cache mode`)
    }
    rows.push({
      id: row.id,
      prompt: row.prompt,
      images: [...row.images],
      ...(row.cache === undefined ? {} : { cache: row.cache }),
    })
  }
  return rows
}

function imageRef(ref: string, caseDirectory: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref) || ref.startsWith('sha256:') || ref.startsWith('{')) return ref
  return isAbsolute(ref) ? ref : resolve(caseDirectory, ref)
}

function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && code.length > 0) return code.slice(0, 80)
  if (error instanceof Error && error.name.length > 0) return error.name.slice(0, 80)
  return 'UNKNOWN_ERROR'
}

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || !/^\d+$/.test(raw)) return fallback
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

describe.skipIf(!RUN)('real visual benchmark corpus', () => {
  it('executes the frozen corpus and writes scorer-compatible JSONL', async () => {
    const casePath = process.env['VISION_BENCHMARK_CASES']
    const resultPath = process.env['VISION_BENCHMARK_RESULTS']
    const providerId = process.env['VISION_BENCHMARK_PROVIDER']
    expect(casePath, 'VISION_BENCHMARK_CASES is required').toBeDefined()
    expect(resultPath, 'VISION_BENCHMARK_RESULTS is required').toBeDefined()
    expect(providerId, 'VISION_BENCHMARK_PROVIDER is required').toBeDefined()

    const cases = parseCases(readFileSync(casePath!, 'utf8'))
    expect(cases.length, 'benchmark corpus must contain at least one case').toBeGreaterThan(0)
    const caseDirectory = dirname(resolve(casePath!))

    const catalog = VISION_PROVIDER_CATALOG.find(entry => entry.id === providerId)
    const baseURL = process.env['VISION_BENCHMARK_BASE_URL'] ?? catalog?.baseURL
    const model = process.env['VISION_BENCHMARK_MODEL'] ?? catalog?.defaultModel
    const apiKeyEnv = process.env['VISION_BENCHMARK_API_KEY_ENV'] ?? catalog?.apiKeyEnv ?? ''
    const apiStyle = process.env['VISION_BENCHMARK_API_STYLE'] ?? catalog?.apiStyle
    expect(baseURL, `benchmark provider ${providerId} needs a catalog entry or VISION_BENCHMARK_BASE_URL`).toBeDefined()
    expect(model, `benchmark provider ${providerId} needs a model or VISION_BENCHMARK_MODEL`).toBeDefined()

    if (apiKeyEnv.length > 0 && process.env[apiKeyEnv] === undefined) {
      const stored = credentialFromFile(apiKeyEnv)
      expect(stored, `credential ${apiKeyEnv} must exist in the environment or DSH credential document`).toBeDefined()
      process.env[apiKeyEnv] = stored
    }

    const ctx = new Context()
    await ctx.plugin(VisionRuntime)
    let tool: ToolLike | undefined
    ctx.provide('tools', {
      register(candidate: ToolLike) {
        if (candidate.name === 'understand_image') tool = candidate
        return () => {}
      },
    } as never)

    apply(ctx, {
      providers: {
        [providerId!]: {
          baseURL: baseURL!,
          model: model!,
          ...(apiKeyEnv.length === 0 ? { keyless: true } : { apiKeyEnv }),
          ...(apiStyle === undefined ? {} : { apiStyle: apiStyle as 'chat-completions' | 'responses' }),
        },
      },
      active: providerId!,
    })
    expect(tool, 'image-mind must register understand_image').toBeDefined()

    const timeoutMs = integerEnv('VISION_BENCHMARK_TIMEOUT_MS', 60_000)
    const output: string[] = []
    for (const testCase of cases) {
      const refs = testCase.images.map(ref => imageRef(ref, caseDirectory))
      const started = performance.now()
      try {
        const result = await tool!.execute({
          ...(refs.length === 1 ? { image: refs[0] } : { images: refs }),
          prompt: testCase.prompt,
          ...(testCase.cache === undefined ? {} : { cache: testCase.cache }),
        }, { signal: AbortSignal.timeout(timeoutMs) })
        const elapsed = Math.max(0, Math.round(performance.now() - started))
        output.push(JSON.stringify({
          id: testCase.id,
          mode: 'tool-direct',
          answer: result.text,
          toolCalled: true,
          latencyMs: elapsed,
          provider: result.provider,
          model: result.model,
          ...(result.route === undefined ? {} : { route: result.route }),
          ...(result.trace === undefined ? {} : result.trace),
          ...(result.usage?.inputTokens === undefined ? {} : { inputTokens: result.usage.inputTokens }),
          ...(result.usage?.outputTokens === undefined ? {} : { outputTokens: result.usage.outputTokens }),
          error: null,
        }))
      } catch (error) {
        const elapsed = Math.max(0, Math.round(performance.now() - started))
        const trace = (error as { trace?: ToolResult['trace'] } | null)?.trace
        output.push(JSON.stringify({
          id: testCase.id,
          mode: 'tool-direct',
          answer: '',
          toolCalled: true,
          latencyMs: elapsed,
          ...(trace === undefined ? {} : trace),
          error: safeErrorCode(error),
        }))
      }
    }

    writeFileSync(resultPath!, `${output.join('\n')}\n`, 'utf8')
    expect(output).toHaveLength(cases.length)
  }, 60 * 60 * 1000)
})
