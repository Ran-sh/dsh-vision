/**
 * Credential/private-material redaction for CLI output and errors.
 *
 * Process failures can echo environments, URLs or arguments. Before any
 * text reaches stdout/stderr it passes through here so common secret shapes
 * and the user's home directory prefix never appear in terminal scrollback.
 */

import { homedir, platform } from 'node:os'

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // OpenAI-style keys and similar sk- tokens (test fixtures use sk-test).
  [/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***'],
  // Bearer/authorization headers.
  [/(bearer\s+)[^\s'"]+/gi, '$1***'],
  // Explicit key/value secret assignments in urls or text.
  [/((?:api[_-]?key|token|secret|password|passwd|pwd|authorization)["'=:\s]+)[^\s'"&]+/gi, '$1***'],
]

function homePrefixes(): string[] {
  const prefixes = new Set<string>()
  try {
    const home = homedir()
    if (home && home !== '/' && home.length > 1) prefixes.add(home)
  } catch {
    // homedir() is effectively always available; guard anyway.
  }
  if (platform() === 'win32') {
    try {
      const profile = process.env.USERPROFILE
      if (profile) prefixes.add(profile)
    } catch {
      // env access guarded for exotic runtimes.
    }
  }
  return [...prefixes]
}

/** Replace every recognized secret shape and home path with safe placeholders. */
export function redactText(input: string): string {
  let output = input
  for (const home of homePrefixes()) {
    output = output.split(home).join('~')
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

/** Redact an unknown thrown value into a safe one-line message. */
export function redactError(error: unknown): string {
  if (error instanceof Error) return redactText(error.message)
  if (typeof error === 'string') return redactText(error)
  return redactText(String(error))
}
