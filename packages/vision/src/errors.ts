/**
 * Typed vision failures with provider-neutral error codes and optional
 * execution tracing for failed diagnostics/benchmarks.
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { VisionTrace } from './types.ts'

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

export class VisionError extends HarnessError {
  declare readonly code: VisionErrorCode
  readonly trace?: VisionTrace

  constructor(message: string, code: VisionErrorCode, options?: { cause?: unknown; trace?: VisionTrace }) {
    super(message, code, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'VisionError'
    if (options?.trace !== undefined) this.trace = options.trace
  }
}

export function isVisionError(value: unknown): value is VisionError {
  return value instanceof VisionError
}

/** Deep-freeze snapshots while keeping AbortSignal live/mutable. */
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
