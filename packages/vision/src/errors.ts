/**
 * Typed vision failures: extends the harness `HarnessError` base so the
 * `code` string is the shared taxonomy (exactly as `LlmError` and `WebError`
 * extend it), with a stable provider-neutral code per failure class. Tool
 * results and the settings card route on `code`, never by parsing `message`.
 *
 * Registration lifecycle failures carry their own codes —`DUPLICATE_ADAPTER`,
 * `INVALID_ADAPTER`, `REGISTRATION_DISPOSED`, `DUPLICATE_PROVIDER`,
 * `INVALID_PROVIDER` —so a registry conflict is never mistaken for a plain
 * provider lookup miss (`PROVIDER_NOT_FOUND`). Adapter-level failures (auth,
 * rate limit, timeout, network, response shape) belong to the provider
 * plugin's own error vocabulary and wrap into the generic `PROVIDER_ERROR`
 * when they cross the seam.
 * @module @ran-sh/dsh-vision/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable provider-neutral failure classes for one vision operation. */
export type VisionErrorCode =
  // Request / provider lookup.
  | 'PROVIDER_NOT_FOUND'
  | 'NO_ADAPTER'
  | 'MODEL_NOT_FOUND'
  | 'UNSUPPORTED_PROTOCOL'
  // Registration lifecycle.
  | 'DUPLICATE_ADAPTER'
  | 'INVALID_ADAPTER'
  | 'REGISTRATION_DISPOSED'
  | 'DUPLICATE_PROVIDER'
  | 'INVALID_PROVIDER'
  | 'DUPLICATE_DIRECTORY'
  | 'INVALID_DIRECTORY'
  // Default-provider ownership.
  | 'DUPLICATE_DEFAULT_PROVIDER'
  // Provider wire failures crossing the seam.
  | 'PROVIDER_ERROR'

/**
 * Typed error for one vision operation. Carries the stable {@link code};
 * adapter-internal detail (HTTP status, provider messages) arrives chained
 * through `cause` and never leaks transport vocabulary into the code.
 */
export class VisionError extends HarnessError {
  /** Stable machine-routable failure class. */
  declare readonly code: VisionErrorCode

  /**
   * @param message - human-readable failure summary.
   * @param code - stable provider-neutral machine code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: VisionErrorCode, options?: { cause?: unknown }) {
    super(message, code, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'VisionError'
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
    // A live signal must stay mutable so cancellation still works.
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
