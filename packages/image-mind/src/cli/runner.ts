/**
 * Injection-resistant process runner for the lifecycle CLI.
 *
 * Every child process is spawned as `executable + argv array` with
 * `shell: false`. Profile names, package specs and paths are passed strictly
 * as DATA — they are never concatenated into a command string, so hostile
 * input cannot become shell syntax. The official dsh entry is executed by
 * the current Node binary (`node <dsh>/lib/bin.js`), which sidesteps
 * platform `.cmd`/`.sh` launcher shims entirely.
 *
 * Captured stdout/stderr is redacted before it can reach the terminal, and
 * failures surface as meaningful exit codes rather than stack traces.
 */

import { spawn } from 'node:child_process'
import { redactText } from './redact.ts'

export interface RunOptions {
  /** Working directory for the child (default: inherit). */
  cwd?: string
  /** Extra environment variables layered over process.env. */
  env?: NodeJS.ProcessEnv
  /** Kill the child after this many milliseconds. */
  timeoutMs?: number
  /** Maximum captured output per stream before truncation (bytes). */
  maxBufferBytes?: number
}

export interface RunResult {
  /** Process exit code; null when terminated by a signal or spawn error. */
  exitCode: number | null
  stdout: string
  stderr: string
  /** Redacted spawn-failure description (ENOENT, timeout, ...). */
  error?: string
  /** True when exitCode === 0 and no spawn error occurred. */
  ok: boolean
}

const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024

function truncate(bytes: Buffer, limit: number): string {
  const clipped = bytes.length > limit ? bytes.subarray(0, limit) : bytes
  return clipped.toString('utf8')
}

export function runProcess(executable: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false
    const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env === undefined ? process.env : { ...process.env, ...options.env },
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        exitCode: null,
        stdout: '',
        stderr: '',
        error: redactText(error instanceof Error ? error.message : String(error)),
        ok: false,
      })
      return
    }

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            child.kill()
          }, options.timeoutMs)

    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes <= maxBuffer) stdout.push(chunk)
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes <= maxBuffer) stderr.push(chunk)
    })

    const finish = (exitCode: number | null, error?: string) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      const stdoutText = redactText(truncate(Buffer.concat(stdout), maxBuffer))
      const stderrText = redactText(truncate(Buffer.concat(stderr), maxBuffer))
      const finalError = timedOut ? 'process timed out' : error
      resolve({
        exitCode,
        stdout: stdoutText,
        stderr: stderrText,
        error: finalError,
        ok: finalError === undefined && exitCode === 0,
      })
    }

    child.on('error', (error) => finish(null, redactText(error instanceof Error ? error.message : String(error))))
    child.on('close', (code) => finish(code))
  })
}
