/**
 * Standalone esbuild config for dsh-plugin-image-mind.
 *
 * The node half (tool registration + attach route + settings section + vision
 * client) bundles to lib/index.js with every @deepseek-ai/* peer and
 * schemastery external — they resolve at runtime from the dsh profile tree.
 *
 * The browser half bundles to lib/client.js as a closure-factory artifact: the
 * bundle calls window.__ModuleLoader__.load({id, factory}) exactly like the
 * shell's own plugin client bundles. My client is pure DOM + fetch with no
 * platform-module imports, so nothing needs the loader's require table.
 */
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const PKG = 'dsh-plugin-image-mind'

await rm('lib', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  sourcemap: true,
  external: ['@deepseek-ai/*', 'schemastery'],
  logLevel: 'info',
})

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
  banner: {
    js: `var module = { exports: {} }; var exports = module.exports;`
      + `\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(PKG)}, factory: (require) => {`,
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})
