/** Run the deterministic baseline and layered-evidence benchmark suites. */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const benchmarkRoot = join(repoRoot, 'benchmarks', 'vision')
const vitest = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs')
mkdirSync(benchmarkRoot, { recursive: true })

let exitCode = 0
for (const [mode, output] of [
  ['baseline', 'results.baseline.jsonl'],
  ['candidate', 'results.candidate.jsonl'],
]) {
  const result = spawnSync(process.execPath, [vitest, 'run', 'tests/deterministic-vision-benchmark.test.ts'], {
    cwd: join(repoRoot, 'packages', 'image-mind'),
    stdio: 'inherit',
    env: {
      ...process.env,
      RUN_DETERMINISTIC_VISION_BENCHMARK: '1',
      DETERMINISTIC_VISION_BENCHMARK_MODE: mode,
      DETERMINISTIC_VISION_BENCHMARK_CASES: join(benchmarkRoot, 'cases.jsonl'),
      DETERMINISTIC_VISION_BENCHMARK_RESULTS: join(benchmarkRoot, output),
    },
  })
  if ((result.status ?? 1) !== 0) exitCode = result.status ?? 1
}

process.exitCode = exitCode
