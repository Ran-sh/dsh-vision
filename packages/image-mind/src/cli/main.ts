/**
 * Argument parsing and top-level dispatch for the lifecycle CLI.
 *
 * The parser is hand-rolled and dependency-free: every value stays a plain
 * string that later travels as an argv element (never interpolated into a
 * shell command), unknown options are rejected loudly, and `--help` output
 * documents the official-command delegation contract.
 */

import { DEFAULT_PROFILE, isCliCommand, USAGE } from './constants.ts'
import { execute } from './execute.ts'
import type { CommandOutcome } from './execute.ts'
import { redactError } from './redact.ts'

export class UsageError extends Error {}

export interface ParsedInvocation {
  command?: 'install' | 'update' | 'status' | 'uninstall'
  profile: string
  json: boolean
  from?: string
  dshBin?: string
  help: boolean
  version: boolean
}

const OPTION_VALUE = new Set(['--profile', '--from', '--dsh-bin'])

export function parseArgv(argv: readonly string[]): ParsedInvocation {
  const parsed: ParsedInvocation = {
    profile: DEFAULT_PROFILE,
    json: false,
    help: false,
    version: false,
  }
  let sawCommand = false

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (token === '-h' || token === '--help') {
      parsed.help = true
      continue
    }
    if (token === '-V' || token === '--version') {
      parsed.version = true
      continue
    }
    if (token === '--json') {
      parsed.json = true
      continue
    }
    if (OPTION_VALUE.has(token)) {
      const value = argv[index + 1]
      if (value === undefined) throw new UsageError(`option ${token} requires a value`)
      if (token === '--profile') parsed.profile = value
      else if (token === '--from') parsed.from = value
      else parsed.dshBin = value
      index++
      continue
    }
    if (token.startsWith('--')) throw new UsageError(`unknown option ${token}`)
    if (!sawCommand) {
      if (!isCliCommand(token)) {
        throw new UsageError(
          `unknown command ${JSON.stringify(token)}; expected install | update | status | uninstall`,
        )
      }
      parsed.command = token
      sawCommand = true
      continue
    }
    throw new UsageError(`unexpected extra argument ${JSON.stringify(token)}`)
  }
  return parsed
}

function renderHumanStatus(report: Record<string, unknown>): string[] {
  const harness = report['harness'] as { target: string; detected: string | null }
  const plugin = report['plugin'] as {
    name: string
    installed: boolean
    version: string | null
    relation: string
    layerActive: boolean
  }
  const service = report['service'] as {
    name: string
    present: boolean
    version: string | null
    referencedByOtherLayers: string[]
  }
  const lines = [
    `profile ${report['profile']} (${report['profileDir'] ?? 'not initialized'})`,
    `harness: target ${harness.target}, detected ${harness.detected ?? 'not found'}`,
    plugin.installed
      ? `plugin ${plugin.name}: installed ${plugin.version} (${plugin.relation}${plugin.layerActive ? ', layer active' : ', layer NOT active'})`
      : `plugin ${plugin.name}: not installed`,
    service.present
      ? `service ${service.name}: present ${service.version}`
      : `service ${service.name}: absent`,
  ]
  if (service.referencedByOtherLayers.length > 0) {
    lines.push(`service shared with: ${service.referencedByOtherLayers.join(', ')}`)
  }
  return lines
}

export function renderOutcome(outcome: CommandOutcome, json: boolean): string {
  if (json && outcome.report !== undefined) return JSON.stringify(outcome.report, null, 2)
  if (json) return JSON.stringify({ ok: outcome.ok, lines: outcome.lines }, null, 2)
  if (outcome.report !== undefined && outcome.report.command === 'status') {
    return [...renderHumanStatus(outcome.report as unknown as Record<string, unknown>), ...outcome.lines].join('\n')
  }
  return outcome.lines.join('\n')
}

/**
 * Programmatic entry point. Returns the process exit code instead of calling
 * process.exit so tests can drive it directly.
 */
export async function main(argv: readonly string[], runningVersion: string): Promise<number> {
  let invocation: ParsedInvocation
  try {
    invocation = parseArgv(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${redactError(error)}\n\n${USAGE}\n`)
      return 1
    }
    throw error
  }

  if (invocation.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (invocation.version) {
    process.stdout.write(`${runningVersion}\n`)
    return 0
  }
  if (invocation.command === undefined) {
    process.stderr.write(`no command given; expected install | update | status | uninstall\n\n${USAGE}\n`)
    return 1
  }

  try {
    const outcome = await execute(
      {
        command: invocation.command,
        profile: invocation.profile,
        json: invocation.json,
        from: invocation.from,
        dshBin: invocation.dshBin,
      },
      runningVersion,
    )
    const text = renderOutcome(outcome, invocation.json)
    if (text.length > 0) (outcome.ok ? process.stdout : process.stderr).write(`${text}\n`)
    return outcome.exitCode
  } catch (error) {
    process.stderr.write(`${redactError(error)}\n`)
    return 1
  }
}
