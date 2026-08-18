/**
 * esbuild config for @ran-sh/dsh-vision: bundles the service package to
 * lib/index.js with every @deepseek-ai/* peer external (resolved at runtime
 * from the DSH profile tree), plus the .d.ts pass via tsc is skipped here —
 * the package ships source and a bundled runtime.
 */
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

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
