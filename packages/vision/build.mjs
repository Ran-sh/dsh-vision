/**
 * esbuild config for @ran-sh/dsh-vision: bundles the service package to
 * lib/index.js with every @deepseek-ai/* peer external (resolved at runtime
 * from the DSH profile tree), then emits the public .d.ts surface into
 * lib/types via a declaration-only tsc pass — the published package carries
 * types, so consumers typecheck against lib/types/index.d.ts.
 */
import { rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { computeInputsHash } from '../../scripts/pack-state.mjs'

const require = createRequire(import.meta.url)
// The declaration pass runs the local typescript bin with the current node
// executable: no .cmd spawning, no shell, identical on POSIX/Windows.
const tscBin = require.resolve('typescript/bin/tsc')

await rm('lib', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  sourcemap: true,
  external: ['@deepseek-ai/*'],
  logLevel: 'info',
})

// Declaration-only pass: emit lib/types/*.d.ts for the src surface.
execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.decl.json'], {
  stdio: 'inherit',
})

// Release fail-safe (Batch 022): record the content hash of declared pack
// inputs so the prepack guard can prove freshness instead of trusting mtimes
// or human memory. The state file never ships (not in the files allowlist).
const { readFileSync: readManifestSync } = await import('node:fs')
const manifest = JSON.parse(readManifestSync('package.json', 'utf8'))
writeFileSync(
  'lib/.pack-state.json',
  `${JSON.stringify({ inputsHash: computeInputsHash(process.cwd(), manifest.packGuard.inputs) }, null, 2)}\n`,
)
