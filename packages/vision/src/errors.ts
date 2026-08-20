/**
 * Typed vision failures: extends the harness `HarnessError` base so the
 * `code` string is the shared taxonomy (exactly as `LlmError` and `WebError`
 * extend it), with a stable provider-neutral code per failure class. Tool
 * results and the settings card route on `code`, never by parsing `message`.
 * @module @ran-sh/dsh-vision/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { VisionTrace } from './types.ts'

/** Stable provider-neutral failure classes for one vision operation. */
export type VisionErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'NO_ADAPTER'
  | 'MODEL_NOT_FOUND'
  | 'UNSUPPORTED_PROTOCOL'
  | 'DUPLICATE_ADAPTER'
  | 'INVALID_ADAPTER'
  | 'REGISTRATION_DISPOSED'
  | 'DUPLICATE_PROVIDER'
  | 'INVALID_PROVIDER'
  | 'DUPLICATE_DIRECTORY'
  | 'INVALID_DIRECTORY'
  | 'DUPLICATE_DEFAULT_PROVIDER'
  | 'PROVIDER_ERROR'

/**
 * Typed error for one vision operation. Adapter-internal transport detail
 * stays in `cause`; optional provider-neutral execution counters make failed
 * benchmark/diagnostic runs observable without exposing secrets or endpoints.
 */
export class VisionError extends HarnessError {
  declare readonly code: VisionErrorCode
  readonly trace?: VisionTrace

  constructor(message: string, code: VisionErrorCode, options?: { cause?: unknown; trace?: VisionTrace }) {
    super(message, code, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'VisionError'
    this.trace = options?.trace
  }
}

/** Narrow an unknown thrown value to a `VisionError`. */
export function isVisionError(value: unknown): value is VisionError {
  return value instanceof VisionError
}

/**
 * Deep-freeze for runtime snapshots. The TypeScript `Readonly<>` / `interface`
 * modifiers are compile-time only; a snapshot an adapter receives must also
 * resist accidental mutation at runtime, so callers freeze the whole object
 * graph before handing it over.
 *
 * Iterative (a WeakSet + explicit pending stack) rather than recursive so a
 * deep graph cannot overflow the call stack; cycles are safe; `AbortSignal`
 * instances are left mutable (freezing a signal breaks later abort).
 */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>()
  const pending: Array<{ kind: 'visit'; node: unknown } | { kind: 'property'; source: Record<string, unknown>; key: string }> = [
    { kind: 'visit', node: value },
  ]
  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) continue
    if (task.kind === 'property') {
      pending.push({ kind: 'visit', node: task.source[task.key] })
      continue
    }
    const node = task.node
    if (node === null || typeof node !== 'object') continue
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    for (const key of Object.keys(node)) {
      pending.push({ kind: 'property', source: node as Record<string, unknown>, key })
    }
  }
  return value
}
