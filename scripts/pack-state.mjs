/**
 * Shared pack-state hashing for the release fail-safe (Batch 022).
 *
 * The defective public 0.2.0 incident shipped metadata-only tarballs because
 * `npm publish` ran from a checkout without build output. The guard makes
 * that impossible: every build records a content hash of its declared
 * inputs next to the outputs, and `prepack` (which npm runs for BOTH
 * `npm pack` and `npm publish`) refuses to let an incomplete or stale
 * package through — rebuilding when inputs changed, failing closed when a
 * build cannot produce the required entries.
 *
 * The hash covers CONTENT, not mtimes, so git checkouts/fresh clones behave
 * deterministically. The state file lives inside the output directory
 * (e.g. lib/.pack-state.json) and is excluded from every package's `files`
 * allowlist, so it never ships.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Recursively collect files under one input path (file or directory). */
function collectFiles(baseDir, inputPath, files) {
  const absolute = join(baseDir, inputPath)
  const stats = statSync(absolute)
  if (stats.isFile()) {
    files.push(absolute)
    return
  }
  if (!stats.isDirectory()) {
    throw new Error(`pack-state input is neither file nor directory: ${inputPath}`)
  }
  for (const entry of readdirSync(absolute)) {
    const entryAbsolute = join(absolute, entry)
    if (statSync(entryAbsolute).isDirectory()) {
      collectFiles(baseDir, join(inputPath, entry), files)
    } else {
      files.push(entryAbsolute)
    }
  }
}

/**
 * Content hash over the declared inputs, stable across platforms:
 * repo-relative POSIX paths paired with sha256(file content), sorted.
 * Returns null when any input path is missing (treated as "must rebuild").
 */
export function computeInputsHash(packageDir, inputs) {
  const files = []
  try {
    for (const inputPath of inputs) {
      collectFiles(packageDir, inputPath, files)
    }
  } catch {
    return null
  }
  const packagePrefix = packageDir.endsWith(sep) ? packageDir : packageDir + sep
  const digest = createHash('sha256')
  const lines = files
    .map((file) => ({
      rel: relative(packagePrefix, file).split(sep).join('/'),
      content: readFileSync(file),
    }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  if (lines.length === 0) return null
  for (const { rel, content } of lines) {
    digest.update(rel)
    digest.update('\u0000')
    digest.update(createHash('sha256').update(content).digest())
    digest.update('\n')
  }
  return digest.digest('hex')
}
