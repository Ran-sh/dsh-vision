/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { benchmarkEnvironment, parseBenchmarkRunArgs } from '../scripts/run-vision-benchmark.mjs'

describe('real vision benchmark runner CLI', () => {
  it('requires cases, output, and provider', () => {
    expect(() => parseBenchmarkRunArgs([])).toThrow(/--cases/)
    expect(() => parseBenchmarkRunArgs(['--cases', 'cases.jsonl', '--out', 'results.jsonl'])).toThrow(/--provider/)
  })

  it('rejects unknown, duplicate, and malformed options', () => {
    expect(() => parseBenchmarkRunArgs([
      '--cases', 'a', '--out', 'b', '--provider', 'p', '--wat', 'x',
    ])).toThrow(/unknown benchmark option/)
    expect(() => parseBenchmarkRunArgs([
      '--cases', 'a', '--cases', 'b', '--out', 'c', '--provider', 'p',
    ])).toThrow(/duplicate benchmark option/)
    expect(() => parseBenchmarkRunArgs([
      '--cases', 'a', '--out', 'b', '--provider', 'p', '--api-style', 'legacy',
    ])).toThrow(/api-style/)
    expect(() => parseBenchmarkRunArgs([
      '--cases', 'a', '--out', 'b', '--provider', 'p', '--timeout-ms', '0',
    ])).toThrow(/positive integer/)
  })

  it('forwards only non-secret metadata and resolves file paths from the caller cwd', () => {
    const options = parseBenchmarkRunArgs([
      '--cases', 'bench/cases.jsonl',
      '--out', 'out/results.jsonl',
      '--provider', 'opencode-go',
      '--model', 'mimo-v2.5',
      '--api-key-env', 'OPENCODE_GO_API_KEY',
      '--api-style', 'responses',
      '--timeout-ms', '90000',
    ])
    const env = benchmarkEnvironment(options, '/workspace/repo')

    expect(env).toMatchObject({
      RUN_VISION_BENCHMARK: '1',
      VISION_BENCHMARK_PROVIDER: 'opencode-go',
      VISION_BENCHMARK_MODEL: 'mimo-v2.5',
      VISION_BENCHMARK_API_KEY_ENV: 'OPENCODE_GO_API_KEY',
      VISION_BENCHMARK_API_STYLE: 'responses',
      VISION_BENCHMARK_TIMEOUT_MS: '90000',
    })
    expect(env.VISION_BENCHMARK_CASES).toMatch(/workspace[\\/]repo[\\/]bench[\\/]cases\.jsonl$/)
    expect(env.VISION_BENCHMARK_RESULTS).toMatch(/workspace[\\/]repo[\\/]out[\\/]results\.jsonl$/)
    expect(JSON.stringify(env)).not.toContain('Bearer ')
  })
})
