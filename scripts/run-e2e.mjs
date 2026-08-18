/**
 * `npm run test:e2e` — run the gated real-endpoint suite (opencode-go /
 * commandcode-goat) with RUN_VISION_E2E=1. Cross-platform: sets the env var
 * in-process instead of relying on shell syntax, then spawns vitest inside
 * the image-mind package.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.RUN_VISION_E2E = '1'
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(process.execPath, [vitest, 'run', 'tests/e2e-real.test.ts'], {
  cwd: join(root, 'packages', 'image-mind'),
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
