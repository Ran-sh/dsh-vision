/**
 * Location and invocation of the OFFICIAL DeepSeek Harness CLI (`dsh`).
 *
 * The lifecycle wrapper must never reimplement plugin management. It locates
 * the installed `@deepseek-ai/dsh` package entry and executes it through the
 * current Node binary as plain argv data. Resolution order:
 *
 *  1. explicit `--dsh-bin <path>` option;
 *  2. `DSH_PLUGIN_IMAGE_MIND_DSH_BIN` environment variable;
 *  3. Node resolution of `@deepseek-ai/dsh/package.json` from the invoking
 *     working directory, then from this CLI's own location (covers npm
 *     workspaces and co-installed layouts);
 *  4. a PATH scan for standard npm/pnpm global layouts
 *     (`<dir>/node_modules/@deepseek-ai/dsh/lib/bin.js`).
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { DSH_BIN_ENV } from './constants.ts'

const requireResolve = createRequire(import.meta.url)

const DSH_PACKAGE_JSON = '@deepseek-ai/dsh/package.json'
const DSH_BIN_SUBPATH = join('@deepseek-ai', 'dsh', 'lib', 'bin.js')

/**
 * Turn a resolved `@deepseek-ai/dsh/package.json` path into the launcher JS
 * the official `bin.dsh` field points at.
 */
function dshEntryFromPackageJson(packageJsonPath: string): string | null {
  const entry = join(dirname(packageJsonPath), 'lib', 'bin.js')
  return existsSync(entry) ? entry : null
}

function executableDshEntry(candidate: string | undefined): string | null {
  if (!candidate) return null
  try {
    const resolved = requireResolve.resolve(candidate)
    if (typeof resolved !== 'string') return null
    return candidate.endsWith('package.json') ? dshEntryFromPackageJson(resolved) : resolved
  } catch {
    return null
  }
}

/** Resolve the official dsh JS entry; null when no installation is found. */
export function resolveDshEntry(explicitPath?: string): string | null {
  if (explicitPath) {
    if (!existsSync(explicitPath)) return null
    return explicitPath
  }
  const fromEnv = process.env[DSH_BIN_ENV]
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const fromCwd = executableDshEntry(DSH_PACKAGE_JSON)
  if (fromCwd) return fromCwd

  for (const segment of (process.env.PATH ?? '').split(delimiter)) {
    if (!segment) continue
    const candidate = join(segment, DSH_BIN_SUBPATH)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Official command-line shape for profile plugin management, mirroring the
 * documented `dsh plugin --profile <name> <args...>` forwarder contract.
 */
export function officialPluginArgs(profile: string, pnpmArgs: string[]): string[] {
  return ['plugin', '--profile', profile, ...pnpmArgs]
}

/** Official read-only version probe arguments. */
export function officialVersionArgs(): string[] {
  return ['--version']
}

/** Official composition dump arguments (no boot, no network listeners). */
export function officialDumpConfigArgs(profile: string): string[] {
  return ['--profile', profile, '--dump-config']
}
