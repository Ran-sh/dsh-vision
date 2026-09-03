/**
 * Standalone esbuild config for dsh-plugin-image-mind.
 *
 * The node half (tool registration + attach route + settings section + vision
 * provider registration) bundles to lib/index.js with every @deepseek-ai/*
 * peer and schemastery external 鈥?they resolve at runtime from the dsh
 * profile tree. The vision service (@ran-sh/dsh-vision) is external too: it
 * is loaded as its own Cordis entry (the vision-runtime composition row), so
 * image-mind shares the SAME service instance it injects 鈥?bundling a copy
 * would create a second ctx.vision.
 *
 * The browser half bundles to lib/client.js as a closure-factory artifact: the
 * bundle calls window.__ModuleLoader__.load({id, factory}) exactly like the
 * shell's own plugin client bundles.
 */
import { rm } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import { computeInputsHash } from '../../scripts/pack-state.mjs'

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
  external: ['@deepseek-ai/*', '@ran-sh/dsh-vision'],
  // Some source/dependency paths intentionally use runtime require() for Node
  // built-ins. esbuild's ESM helper can only service those calls when a native
  // require binding exists. DSH imports this bundle as ESM, so provide the
  // standard createRequire(import.meta.url) bridge instead of letting the
  // generated helper throw "Dynamic require of node:* is not supported".
  banner: {
    js: "import { createRequire as __imageMindCreateRequire } from 'node:module';\nconst require = __imageMindCreateRequire(import.meta.url);",
  },
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
  // @deepseek-ai/dsh-client-store is a pure store library (no dsh.client
  // manifest, no service to inject) — bundle it so the ModuleLoader never
  // has to resolve a library module at runtime. Every other @deepseek-ai/*
  // client package stays external: the host profile tree provides them.
  // esbuild `external` accepts only strings, so the split is expressed as a
  // resolver plugin instead of a regex.
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  plugins: [{
    name: 'image-mind-harness-external',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\// }, (args) => {
        if (args.path === '@deepseek-ai/dsh-client-store') return undefined
        return { path: args.path, external: true }
      })
      build.onResolve({ filter: /^@ran-sh\// }, (args) => ({ path: args.path, external: true }))
    },
  }],
  banner: {
    js: `var module = { exports: {} }; var exports = module.exports;`
      + `\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(PKG)}, factory: (require) => {`,
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})

// The lifecycle CLI bundles standalone for the npm bin entry
// (`npx dsh-plugin-image-mind install|update|status|uninstall`). Node
// built-ins stay external via platform:'node'; no @deepseek-ai/* or
// @ran-sh/* imports exist here on purpose 鈥?the CLI must run before/without
// any profile tree and delegates everything to the official dsh launcher.
await build({
  entryPoints: ['src/cli/bin.ts'],
  outfile: 'lib/cli.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  sourcemap: true,
  // esbuild preserves bin.ts's #!/usr/bin/env node line on its own.
  logLevel: 'info',
})

// Release fail-safe (Batch 022): record the content hash of declared pack
// inputs so the prepack guard can prove freshness instead of trusting mtimes
// or human memory. The state file never ships (not in the files allowlist).
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
await writeFileSync(
  'lib/.pack-state.json',
  `${JSON.stringify({ inputsHash: computeInputsHash(process.cwd(), manifest.packGuard.inputs) }, null, 2)}\n`,
)