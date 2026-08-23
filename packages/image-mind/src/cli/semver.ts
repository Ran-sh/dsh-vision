/**
 * Minimal prerelease-aware semver comparison for CLI status reporting.
 *
 * Supports the shapes this project actually uses (`M.m.p` and
 * `M.m.p-rc.N`). Returns null for unparsable input so callers can degrade to
 * "unknown" instead of inventing an ordering.
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  pre: string[]
}

export function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  }
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1 // release > prerelease
  if (b.length === 0) return -1
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const left = a[index]
    const right = b[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) {
      const delta = Number(left) - Number(right)
      if (delta !== 0) return delta < 0 ? -1 : 1
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1 // numeric identifiers < alphanumeric
    } else if (left !== right) {
      return left < right ? -1 : 1
    }
  }
  return 0
}

/** -1 when a < b, 0 when equal, 1 when a > b. Null-safe: null sorts lowest. */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): -1 | 0 | 1 | null {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)
  if (parsedA === null && parsedB === null) return null
  if (parsedA === null) return -1
  if (parsedB === null) return 1
  const core =
    Math.sign(parsedA.major - parsedB.major) ||
    Math.sign(parsedA.minor - parsedB.minor) ||
    Math.sign(parsedA.patch - parsedB.patch)
  if (core !== 0) return core as -1 | 0 | 1
  return comparePre(parsedA.pre, parsedB.pre) as -1 | 0 | 1
}

export type VersionRelation = 'same' | 'older' | 'newer' | 'unknown'

/**
 * How an installed version relates to the running CLI version. Absent or
 * unparsable input reports "unknown" rather than guessing.
 */
export function versionRelation(installed: string | null, running: string): VersionRelation {
  if (parseVersion(installed) === null || parseVersion(running) === null) return 'unknown'
  const compared = compareVersions(installed, running)!
  if (compared === 0) return 'same'
  return compared < 0 ? 'older' : 'newer'
}
