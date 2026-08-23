/**
 * Read-only inspection of a DSH profile's plugin/service state.
 *
 * Everything here only READS files that the official Harness lifecycle
 * (`dsh plugin ...`, pnpm) owns and maintains. No function in this module
 * writes, moves or deletes anything — status reporting must never mutate a
 * profile, and the uninstall decision needs an untouched pre-removal
 * snapshot of who references the shared vision service.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DSH_HOME_ENV, PLUGIN_PACKAGE, SERVICE_PACKAGE } from './constants.ts'

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * Conservative profile-name validation. The name still only ever travels as
 * argv data to the official CLI, but rejecting path-ish or shell-hostile
 * shapes early keeps error output meaningful. Mirrors the official
 * `resolveProfileDir` guard (no separators, no dot segments).
 */
export function isValidProfileName(name: string): boolean {
  if (!PROFILE_NAME_PATTERN.test(name)) return false
  if (name === '.' || name === '..' || name === 'node_modules') return false
  return true
}

/** Resolve the harness home exactly like the official launcher does. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DSH_HOME_ENV]
  if (override !== undefined && override.trim().length > 0) return override
  return join(homedir(), '.dsh')
}

export function resolveProfileDir(profile: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), 'profiles', profile)
}

export interface ProfileManifestView {
  /** Raw dependency spec map from the profile manifest (pnpm-owned). */
  dependencies: Record<string, string>
  /** Active bundle layer list maintained by official reconciliation. */
  bundles: string[]
}

export interface PackagePresence {
  present: boolean
  version: string | null
}

export interface ProfileState {
  profile: string
  profileDir: string
  /** True when the official lifecycle has initialized this profile. */
  initialized: boolean
  manifest: ProfileManifestView | null
  pluginSpec: string | null
  plugin: PackagePresence
  service: PackagePresence
  /**
   * Other top-level profile dependencies whose installed manifests declare
   * a dependency on the vision service — official evidence the service must
   * survive an image-mind removal.
   */
  serviceReferencedBy: string[]
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function readManifestView(profileDir: string): ProfileManifestView | null {
  const raw = readJsonFile(join(profileDir, 'package.json'))
  if (raw === null) return null
  const dshSection = raw['dsh'] as { profile?: { bundles?: unknown } } | undefined
  const bundles = dshSection?.profile?.bundles
  return {
    dependencies: { ...(raw['dependencies'] as Record<string, string> | undefined) },
    bundles: Array.isArray(bundles) ? bundles.map(String) : [],
  }
}

function readInstalledVersion(profileDir: string, packageName: string): PackagePresence {
  const raw = readJsonFile(join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json'))
  const version = raw?.['version']
  if (typeof version === 'string') return { present: true, version }
  return { present: false, version: null }
}

function findServiceReferencers(profileDir: string, manifest: ProfileManifestView | null): string[] {
  if (manifest === null) return []
  const referencers: string[] = []
  for (const name of Object.keys(manifest.dependencies)) {
    if (name === PLUGIN_PACKAGE || name === SERVICE_PACKAGE) continue
    const installed = readJsonFile(
      join(profileDir, 'node_modules', ...name.split('/'), 'package.json'),
    )
    const dependencies = installed?.['dependencies'] as Record<string, unknown> | undefined
    if (dependencies && SERVICE_PACKAGE in dependencies) referencers.push(name)
  }
  return referencers.sort((a, b) => a.localeCompare(b))
}

/** Snapshot the profile state without touching anything. */
export function readProfileState(profile: string, env: NodeJS.ProcessEnv = process.env): ProfileState {
  const profileDir = resolveProfileDir(profile, env)
  const initialized = existsSync(join(profileDir, 'package.json'))
  const manifest = readManifestView(profileDir)
  return {
    profile,
    profileDir,
    initialized,
    manifest,
    pluginSpec: manifest?.dependencies[PLUGIN_PACKAGE] ?? null,
    plugin:
      manifest !== null && PLUGIN_PACKAGE in manifest.dependencies
        ? readInstalledVersion(profileDir, PLUGIN_PACKAGE)
        : { present: false, version: null },
    service: readInstalledVersion(profileDir, SERVICE_PACKAGE),
    serviceReferencedBy: findServiceReferencers(profileDir, manifest),
  }
}
