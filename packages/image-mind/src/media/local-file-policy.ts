/**
 * Local filesystem capability fence for model-supplied image references.
 *
 * A hosted main model must never gain the ability to read arbitrary files
 * from the host machine by guessing an absolute path. The default policy is
 * therefore total: only session/attachment references, http(s) URLs and bare
 * attachment ids are loadable inputs. When a deployment opts in, filesystem
 * reads are confined to realpath containment under one or more explicit
 * allow-listed roots, which also blocks symlink/junction escapes and
 * `..` traversal after resolution.
 * @module dsh-plugin-image-mind/media/local-file-policy
 */

import { realpath } from 'node:fs/promises'
import { isAbsolute, sep } from 'node:path'

/** Whether model-supplied local filesystem paths may be read at all. */
export const DEFAULT_ALLOW_LOCAL_FILES = false

/**
 * Return the canonical absolute path of `input` only when it lies under one
 * of the allow-listed roots (after following symlinks/junctions on both
 * sides). A relative path is never accepted.
 * @param input - the model-supplied path.
 * @param roots - the allow-listed directories (empty = nothing may be read).
 * @returns the resolved contained path.
 */
export async function resolveAuthorizedLocalFile(input: string, roots: readonly string[]): Promise<string> {
  if (roots.length === 0) {
    throw new Error('image-mind: local file paths are disabled for image references; use a session attachment, an http(s) URL, or an attachment id')
  }
  if (!isAbsolute(input)) {
    throw new Error('image-mind: local file paths must be absolute and inside an allowed local-file root')
  }
  let actual: string
  try {
    actual = await realpath(input)
  } catch (error) {
    throw new Error(`image-mind: local image path ${JSON.stringify(input)} could not be resolved: ${(error as Error).message}`)
  }
  const normalized = actual.split(sep).join('/')
  for (const rawRoot of roots) {
    let realRoot: string
    try {
      realRoot = await realpath(rawRoot)
    } catch {
      continue
    }
    const rootNormalized = realRoot.split(sep).join('/')
    const rootPrefix = rootNormalized.endsWith('/') ? rootNormalized : `${rootNormalized}/`
    if (normalized === rootNormalized || normalized.startsWith(rootPrefix)) return actual
  }
  throw new Error('image-mind: local image path is outside the allowed local-file roots')
}

/**
 * Determine whether a bare (non-URL, non-attachment) reference should be
 * treated as a filesystem path at all. Only a path that was *supplied*
 * absolute counts — resolving a relative string against the working directory
 * must never upgrade it into a readable local file.
 * @param input - the trimmed reference.
 * @param allowLocalFiles - the resolved policy flag.
 * @param localFileRoots - the resolved allow-listed roots.
 * @returns true when the path is authorized and therefore loadable.
 */
export function isAuthorizedLocalPath(input: string, allowLocalFiles: boolean, localFileRoots: readonly string[]): boolean {
  if (!allowLocalFiles || localFileRoots.length === 0) return false
  return isAbsolute(input)
}
