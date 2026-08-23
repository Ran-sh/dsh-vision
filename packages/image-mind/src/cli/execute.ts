/**
 * Command execution: turns parsed CLI intent into official DSH lifecycle
 * operations and structured outcomes.
 *
 * Mutating commands run exactly one official `dsh plugin` invocation per
 * decision (never raw pnpm, never direct file edits) with the resolved
 * official launcher. Status never spawns the mutating surface at all.
 */

import { PLUGIN_PACKAGE, SERVICE_PACKAGE } from './constants.ts'
import { officialDumpConfigArgs, officialPluginArgs, officialVersionArgs, resolveDshEntry } from './dsh.ts'
import { readProfileState, type ProfileState } from './profile.ts'
import {
  buildStatusReport,
  decideInstall,
  decideUpdate,
  sharedServiceReferencers,
  type Decision,
  type StatusReport,
} from './plan.ts'
import { parseVersion } from './semver.ts'
import { runProcess, type RunResult } from './runner.ts'

export interface CliRequest {
  command: 'install' | 'update' | 'status' | 'uninstall'
  profile: string
  json: boolean
  /** Advanced package-spec override for install/update (tarball etc.). */
  from?: string
  dshBin?: string
}

export interface CommandOutcome {
  ok: boolean
  exitCode: number
  /** Human-readable summary lines (already safe/redacted). */
  lines: string[]
  /** Stable machine payload; present for status and useful elsewhere. */
  report?: StatusReport | LifecycleReport
}

export interface LifecycleReport {
  ok: boolean
  command: 'install' | 'update' | 'uninstall'
  profile: string
  cliVersion: string
  action: 'noop' | 'official'
  reason: string
  officialExitCode?: number | null
  serviceRetainedBy?: string[]
  servicePresentAfter?: boolean
}

interface ExecutionContext {
  request: CliRequest
  dshEntry: string
  state: ProfileState
  runningVersion: string
}

const SPAWN_TIMEOUT_MS = 10 * 60 * 1000

function fail(lines: string[], code = 1): CommandOutcome {
  return { ok: false, exitCode: code, lines }
}

function describeFailure(run: RunResult): string[] {
  const lines = [`official command failed (exit ${run.exitCode ?? 'n/a'})`]
  if (run.error !== undefined) lines.push(`error: ${run.error}`)
  if (run.stderr.trim().length > 0) lines.push(run.stderr.trimEnd())
  return lines
}

async function probeHarnessVersion(dshEntry: string): Promise<string | null> {
  const run = await runProcess(process.execPath, [dshEntry, ...officialVersionArgs()], {
    timeoutMs: 30_000,
  })
  if (!run.ok) return null
  return parseVersion(run.stdout.trim()) === null ? null : run.stdout.trim()
}

async function runOfficial(context: ExecutionContext, decision: Decision): Promise<CommandOutcome> {
  const args = officialPluginArgs(context.request.profile, [decision.verb!, decision.spec!])
  const run = await runProcess(process.execPath, [context.dshEntry, ...args], {
    timeoutMs: SPAWN_TIMEOUT_MS,
  })
  if (!run.ok) {
    return fail([
      `profile ${context.request.profile}: ${decision.reason}`,
      ...describeFailure(run),
    ])
  }
  return { ok: true, exitCode: 0, lines: [`profile ${context.request.profile}: ${decision.reason}`] }
}

async function executeInstall(context: ExecutionContext): Promise<CommandOutcome> {
  const spec = context.request.from ?? `${PLUGIN_PACKAGE}@${context.runningVersion}`
  const decision = decideInstall(context.state, spec)
  if (decision.mode === 'error') return fail([decision.reason])
  if (decision.mode === 'noop') {
    const report: LifecycleReport = {
      ok: true,
      command: 'install',
      profile: context.request.profile,
      cliVersion: context.runningVersion,
      action: 'noop',
      reason: decision.reason,
    }
    return { ok: true, exitCode: 0, lines: [decision.reason], report }
  }
  const outcome = await runOfficial(context, decision)
  const report: LifecycleReport = {
    ok: outcome.ok,
    command: 'install',
    profile: context.request.profile,
    cliVersion: context.runningVersion,
    action: 'official',
    reason: decision.reason,
    officialExitCode: outcome.ok ? 0 : outcome.exitCode,
  }
  return { ...outcome, report }
}

async function executeUpdate(context: ExecutionContext): Promise<CommandOutcome> {
  const decision = decideUpdate(context.state, context.runningVersion)
  if (decision.mode === 'error') return fail([decision.reason])
  if (decision.mode === 'noop') {
    const report: LifecycleReport = {
      ok: true,
      command: 'update',
      profile: context.request.profile,
      cliVersion: context.runningVersion,
      action: 'noop',
      reason: decision.reason,
    }
    return { ok: true, exitCode: 0, lines: [decision.reason], report }
  }
  // `--from` converges to an explicit artifact instead of a registry spec.
  const effective: Decision = context.request.from
    ? { mode: 'official', verb: 'add', spec: context.request.from, reason: decision.reason }
    : decision
  const outcome = await runOfficial(context, effective)
  const after = readProfileState(context.request.profile)
  const report: LifecycleReport = {
    ok: outcome.ok,
    command: 'update',
    profile: context.request.profile,
    cliVersion: context.runningVersion,
    action: 'official',
    reason: decision.reason,
    officialExitCode: outcome.ok ? 0 : outcome.exitCode,
    servicePresentAfter: after.service.present,
  }
  return { ...outcome, report }
}

async function executeUninstall(context: ExecutionContext): Promise<CommandOutcome> {
  const before = readProfileState(context.request.profile)
  const retainedByBefore = sharedServiceReferencers(before)

  let outcome: CommandOutcome
  if (!before.plugin.present && !before.manifest?.bundles.includes(PLUGIN_PACKAGE)) {
    outcome = {
      ok: true,
      exitCode: 0,
      lines: [`profile ${before.profile}: ${PLUGIN_PACKAGE} already absent; nothing to do`],
    }
  } else {
    const decision: Decision = {
      mode: 'official',
      verb: 'remove',
      spec: PLUGIN_PACKAGE,
      reason: `official remove of ${PLUGIN_PACKAGE} from profile ${before.profile}`,
    }
    outcome = await runOfficial({ ...context, state: before }, decision)
  }

  const after = readProfileState(context.request.profile)
  const servicePresentAfter = after.service.present
  const retainedBy =
    servicePresentAfter && retainedByBefore.length > 0
      ? retainedByBefore
      : servicePresentAfter && after.manifest !== null
        ? []
        : []

  const retentionNote =
    !after.service.present || !outcome.ok
      ? undefined
      : retainedBy.length > 0
        ? `${SERVICE_PACKAGE} kept in the profile because it is still referenced by: ${retainedBy.join(', ')}`
        : `${SERVICE_PACKAGE} remains installed in the profile (left for official tooling to manage; no manual deletion is performed)`

  const lines = [...outcome.lines]
  if (retentionNote !== undefined) lines.push(retentionNote)
  else if (outcome.ok && !after.service.present && before.service.present) {
    lines.push(`${SERVICE_PACKAGE} pruned by official tooling after removal`)
  }

  const report: LifecycleReport = {
    ok: outcome.ok,
    command: 'uninstall',
    profile: before.profile,
    cliVersion: context.runningVersion,
    action: outcome.lines.some((line) => line.includes('official remove')) ? 'official' : 'noop',
    reason:
      outcome.ok && !before.plugin.present
        ? `${PLUGIN_PACKAGE} already absent from profile ${before.profile}`
        : `official remove executed against profile ${before.profile}`,
    officialExitCode: outcome.ok ? 0 : outcome.exitCode,
    serviceRetainedBy: retainedBy.length > 0 ? retainedBy : undefined,
    servicePresentAfter,
  }
  return { ok: outcome.ok, exitCode: outcome.exitCode, lines, report }
}

async function executeStatus(context: ExecutionContext): Promise<CommandOutcome> {
  const detected = await probeHarnessVersion(context.dshEntry)
  const report = buildStatusReport(
    readProfileState(context.request.profile),
    context.runningVersion,
    detected,
    'exact @deepseek-ai/dsh@0.1.1-rc.2 line',
  )
  return { ok: true, exitCode: 0, lines: [], report }
}

/**
 * Composition smoke helper used by acceptance flows: dump-config proves both
 * bundle layers compose without booting listeners. Exported for tests.
 */
export async function compositionSmoke(dshEntry: string, profile: string): Promise<{ ok: boolean; text: string }> {
  const run = await runProcess(process.execPath, [dshEntry, ...officialDumpConfigArgs(profile)], {
    timeoutMs: SPAWN_TIMEOUT_MS,
  })
  return { ok: run.ok, text: run.stdout + run.stderr }
}

export async function execute(request: CliRequest, runningVersion: string): Promise<CommandOutcome> {
  const dshEntry = resolveDshEntry(request.dshBin)
  if (dshEntry === null) {
    return fail([
      'unable to locate the official @deepseek-ai/dsh CLI entry.',
      'Install DeepSeek Harness (npm install -g @deepseek-ai/dsh) or pass --dsh-bin <path>.',
    ])
  }
  const context: ExecutionContext = {
    request,
    dshEntry,
    state: readProfileState(request.profile),
    runningVersion,
  }
  switch (request.command) {
    case 'install':
      return executeInstall(context)
    case 'update':
      return executeUpdate(context)
    case 'status':
      return executeStatus(context)
    case 'uninstall':
      return executeUninstall(context)
  }
}
