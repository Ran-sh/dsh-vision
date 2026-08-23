/**
 * Pure decision logic for lifecycle commands.
 *
 * These planners turn a read-only {@link ProfileState} snapshot plus CLI
 * intent into either a no-op outcome or the exact OFFICIAL argv to run
 * (`dsh plugin --profile <name> add|remove <spec>`). Keeping decisions pure
 * makes idempotence, convergence and retention behavior unit-testable
 * without spawning anything.
 */

import { PLUGIN_PACKAGE, SERVICE_PACKAGE } from './constants.ts'
import type { ProfileState } from './profile.ts'
import { versionRelation } from './semver.ts'

/** A decision is either a safe no-op or one official operation. */
export interface Decision {
  mode: 'noop' | 'official' | 'error'
  /** Official pnpm verb forwarded through `dsh plugin` (official mode). */
  verb?: 'add' | 'remove'
  /** Exact package spec forwarded as DATA (official mode). */
  spec?: string
  /** Human-readable rationale recorded in output and tests. */
  reason: string
}

/**
 * Install converges the profile to the requested spec exactly once. When the
 * installed plugin already satisfies an exact `name@version` request and the
 * official layer list already contains it, the second install is a safe
 * no-op instead of a duplicate layer push.
 */
export function decideInstall(state: ProfileState, requestedSpec: string): Decision {
  const exactRequest = /^dsh-plugin-image-mind@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(requestedSpec)
  if (exactRequest && state.plugin.present && state.plugin.version === exactRequest[1]) {
    if (state.manifest !== null && state.manifest.bundles.includes(PLUGIN_PACKAGE)) {
      return {
        mode: 'noop',
        reason: `${PLUGIN_PACKAGE}@${exactRequest[1]} already installed and active in profile ${state.profile}`,
      }
    }
  }
  return {
    mode: 'official',
    verb: 'add',
    spec: requestedSpec,
    reason: `official add ${requestedSpec} into profile ${state.profile}`,
  }
}

/**
 * Update converges an INSTALLED plugin to the exact running CLI version:
 * same version is a safe no-op/success, older/newer installs converge via
 * the official forwarder, and an absent plugin is an error that points at
 * `install` instead of silently installing.
 */
export function decideUpdate(state: ProfileState, runningVersion: string): Decision {
  if (!state.plugin.present || state.plugin.version === null) {
    return { mode: 'error', reason: `${PLUGIN_PACKAGE} is not installed in profile ${state.profile}; run install first` }
  }
  const relation = versionRelation(state.plugin.version, runningVersion)
  if (relation === 'same') {
    return { mode: 'noop', reason: `${PLUGIN_PACKAGE}@${state.plugin.version} already matches the CLI version` }
  }
  return {
    mode: 'official',
    verb: 'add',
    spec: `${PLUGIN_PACKAGE}@${runningVersion}`,
    reason: `installed ${state.plugin.version} is ${relation} than CLI ${runningVersion}; official add converges the profile`,
  }
}

/**
 * Uninstall evidence gathered BEFORE removal: packages other than this
 * plugin whose installed manifests reference the shared vision service. The
 * service itself is never force-deleted; the official remove (pnpm) prunes
 * it only when nothing references it, and this list explains any retention.
 */
export function sharedServiceReferencers(state: ProfileState): string[] {
  return state.serviceReferencedBy.filter((name) => name !== PLUGIN_PACKAGE)
}

/** Stable status payload for both human and `--json` rendering. */
export interface StatusReport {
  ok: boolean
  command: 'status'
  profile: string
  profileDir: string | null
  cliVersion: string
  harness: {
    /** Compatibility target compiled into this CLI (exact rc.2 line). */
    target: string
    /** Version reported by the located official launcher, when found. */
    detected: string | null
  }
  plugin: {
    name: string
    installed: boolean
    version: string | null
    /** absent | same | older | newer | unknown (relative to the CLI). */
    relation: 'absent' | 'same' | 'older' | 'newer' | 'unknown'
    layerActive: boolean
    dependencySpec: string | null
  }
  service: {
    name: string
    present: boolean
    version: string | null
    referencedByOtherLayers: string[]
  }
}

export function buildStatusReport(
  state: ProfileState,
  cliVersion: string,
  detectedHarnessVersion: string | null,
  compatibilityTarget: string,
): StatusReport {
  return {
    ok: true,
    command: 'status',
    profile: state.profile,
    profileDir: state.initialized ? state.profileDir : null,
    cliVersion,
    harness: { target: compatibilityTarget, detected: detectedHarnessVersion },
    plugin: {
      name: PLUGIN_PACKAGE,
      installed: state.plugin.present,
      version: state.plugin.version,
      relation: state.plugin.present ? versionRelation(state.plugin.version, cliVersion) : 'absent',
      layerActive: state.manifest?.bundles.includes(PLUGIN_PACKAGE) ?? false,
      dependencySpec: state.pluginSpec,
    },
    service: {
      name: SERVICE_PACKAGE,
      present: state.service.present,
      version: state.service.version,
      referencedByOtherLayers: sharedServiceReferencers(state),
    },
  }
}
