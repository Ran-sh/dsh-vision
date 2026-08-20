/**
 * Run the gated tool-direct visual benchmark in a real provider environment.
 *
 * This wrapper intentionally delegates execution to Vitest so the benchmark
 * can import the TypeScript workspace sources exactly like the existing real
 * E2E suite. Secrets stay in the environment / DSH credential document; only
 * case/result paths and non-secret provider connection metadata are forwarded.
 */

import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VALUE_FLAGS = new Set([
  '--cases', '--out', '--provider', '--model', '--base-url', '--api-key-env', '--api-style', '--timeout-ms',
])

export function parseBenchmarkRunArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown benchmark option: ${flag}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${flag}`)
    if (options[flag] !== undefined) throw new Error(`duplicate benchmark option: ${flag}`)
    options[flag] = value
    index += 1
  }

  for (const required of ['--cases', '--out', '--provider']) {
    if (typeof options[required] !== 'string' || options[required].trim().length === 0) {
      throw new Error(`required benchmark option missing: ${required}`)
    }
  }
  if (options['--api-style'] !== undefined && !['chat-completions', 'responses'].includes(options['--api-style'])) {
    throw new Error('--api-style must be chat-completions or responses')
  }
  if (options['--timeout-ms'] !== undefined && (!/^\d+$/.test(options['--timeout-ms']) || Number(options['--timeout-ms']) <= 0)) {
    throw new Error('--timeout-ms must be a positive integer')
  }
  return options
}

export function benchmarkEnvironment(options, cwd = process.cwd()) {
  const absolute = value => isAbsolute(value) ? value : resolve(cwd, value)
  return {
    RUN_VISION_BENCHMARK: '1',
    VISION_BENCHMARK_CASES: absolute(options['--cases']),
    VISION_BENCHMARK_RESULTS: absolute(options['--out']),
    VISION_BENCHMARK_PROVIDER: options['--provider'],
    ...(options['--model'] === undefined ? {} : { VISION_BENCHMARK_MODEL: options['--model'] }),
    ...(options['--base-url'] === undefined ? {} : { VISION_BENCHMARK_BASE_URL: options['--base-url'] }),
    ...(options['--api-key-env'] === undefined ? {} : { VISION_BENCHMARK_API_KEY_ENV: options['--api-key-env'] }),
    ...(options['--api-style'] === undefined ? {} : { VISION_BENCHMARK_API_STYLE: options['--api-style'] }),
    ...(options['--timeout-ms'] === undefined ? {} : { VISION_BENCHMARK_TIMEOUT_MS: options['--timeout-ms'] }),
  }
}

export function runVisionBenchmark(argv, processCwd = process.cwd()) {
  const options = parseBenchmarkRunArgs(argv)
  const forwarded = benchmarkEnvironment(options, processCwd)
  mkdirSync(dirname(forwarded.VISION_BENCHMARK_RESULTS), { recursive: true })

  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
  const result = spawnSync(process.execPath, [vitest, 'run', 'tests/benchmark-real.test.ts'], {
    cwd: join(root, 'packages', 'image-mind'),
    stdio: 'inherit',
    env: { ...process.env, ...forwarded },
  })
  return result.status ?? 1
}

function printUsage() {
  console.error('usage: npm run benchmark:run -- --cases <cases.jsonl> --out <results.jsonl> --provider <provider-id> [--model <id>] [--base-url <url>] [--api-key-env <NAME>] [--api-style chat-completions|responses] [--timeout-ms <ms>]')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = runVisionBenchmark(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    printUsage()
    process.exitCode = 2
  }
}
