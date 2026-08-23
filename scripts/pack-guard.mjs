#!/usr/bin/env node
/**
 * Release fail-safe guard (Batch 022) 鈥?the prepack hook for both publishable
 * packages.
 *
 * npm runs `prepack` before EVERY `npm pack` and `npm publish`, so a fresh
 * clone + `npm publish` can never reproduce the defective 0.2.0 incident
 * (metadata-only empty-shell tarballs). Behavior:
 *
 *   1. Read `packGuard` from the package manifest: required output entries
 *      and the input paths whose content decides freshness.
 *   2. Compare the current inputs hash against lib/.pack-state.json written
 *      by the last build. On any mismatch/absence 鈥?including a missing
 *      lib/** tree 鈥?run the package's real build (`node build.mjs`).
 *   3. Fail closed: after building, every declared entry must exist and the
 *      recorded state must match; otherwise exit non-zero BEFORE npm can
 *      produce an incomplete tarball.
 *
 * A silent stale-lib publication is impossible by construction: packaging
 * either reflects the current sources or the command fails loudly.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { computeInputsHash } from './pack-state.mjs'

const packageDir = process.cwd()
const manifestPath = join(packageDir, 'package.json')

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error(`[pack-guard] cannot read package.json: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const guard = manifest.packGuard
if (!guard || !Array.isArray(guard.entries) || guard.entries.length === 0 || !Array.isArray(guard.inputs) || guard.inputs.length === 0) {
  console.error(
    '[pack-guard] package.json must declare packGuard: { entries: string[], inputs: string[] } ' +
      'so packaging can prove built artifacts are present and fresh.',
  )
  process.exit(1)
}

if (manifest.scripts?.build === undefined) {
  console.error('[pack-guard] package.json must define a build script for the guard to run.')
  process.exit(1)
}

const statePath = join(dirname(join(packageDir, guard.entries[0])), '.pack-state.json')
const currentHash = computeInputsHash(packageDir, guard.inputs)

function readRecordedHash() {
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    return typeof raw.inputsHash === 'string' ? raw.inputsHash : null
  } catch {
    return null
  }
}

function entriesExist() {
  return guard.entries.every((entry) => existsSync(join(packageDir, entry)))
}

let needsBuild = currentHash === null || currentHash !== readRecordedHash() || !entriesExist()

if (!needsBuild) {
  console.error(`[pack-guard] ${manifest.name}@${manifest.version}: built artifacts present and fresh; nothing to do.`)
} else {
  const reason = currentHash === null ? 'inputs unreadable' : !entriesExist() ? 'required entries missing' : 'inputs changed since last build'
  console.error(`[pack-guard] ${manifest.name}@${manifest.version}: rebuilding (${reason})...`)
  // The real package build, exactly like `npm run build` 鈥?never a shortcut.
  const build = spawnSync(process.execPath, [join(packageDir, 'build.mjs')], { cwd: packageDir, stdio: 'inherit' })
  if (build.status !== 0 || build.error !== undefined) {
    console.error(`[pack-guard] build failed with exit code ${build.status ?? 'n/a'}; refusing to package.`)
    process.exit(1)
  }
}

// Fail-closed verification AFTER the (re)build, BEFORE npm packs anything.
const finalHash = computeInputsHash(packageDir, guard.inputs)
if (finalHash === null || !entriesExist()) {
  console.error(
    `[pack-guard] post-build verification failed for ${manifest.name}: missing entries ` +
      `${guard.entries.filter((entry) => !existsSync(join(packageDir, entry))).join(', ')}. Refusing to package.`,
  )
  process.exit(1)
}
writeFileSync(statePath, `${JSON.stringify({ inputsHash: finalHash }, null, 2)}\n`)
console.error(`[pack-guard] ${manifest.name}@${manifest.version}: verified ${guard.entries.length} required artifact(s).`)
