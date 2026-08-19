/**
 * esbuild config for @ran-sh/dsh-vision: bundles the service package to
 * lib/index.js with every @deepseek-ai/* peer external (resolved at runtime
 * from the DSH profile tree), then emits the public .d.ts surface into
 * lib/types via a declaration-only tsc pass — the published package carries
 * types, so consumers typecheck against lib/types/index.d.ts.
 */
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

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
