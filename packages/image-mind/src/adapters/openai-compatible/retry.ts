/**
 * Retry scheduling for one vision request: bounded exponential backoff with
 * symmetric jitter, mirroring the harness retry-policy semantics without
 * importing LLM business types. Only transient failures (429, 5xx, network,
 * timeout) are retried; auth/config/response-shape failures are never
 * repeated. An aborted signal stops the loop immediately.
 * @module dsh-plugin-image-mind/adapters/openai-compatible/retry
 */

/** Bounded exponential backoff with symmetric jitter around each local delay. */
export interface BackoffConfig {
  /** Initial local exponential-backoff delay in milliseconds (default 500). */
  initialDelayMs?: number
  /** Maximum locally scheduled delay in milliseconds (default 10000). */
  maxDelayMs?: number
  /** Symmetric random multiplier range around one (default 0.1). */
  jitterRatio?: number
}

/** Fully resolved backoff. */
export interface ResolvedBackoff {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

/** Resolve a backoff config with defaults and validation. */
export function resolveBackoff(config: BackoffConfig | undefined): ResolvedBackoff {
  const initialDelayMs = config?.initialDelayMs ?? 500
  const maxDelayMs = config?.maxDelayMs ?? 10_000
  const jitterRatio = config?.jitterRatio ?? 0.1
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0) {
    throw new Error('image-mind: backoff.initialDelayMs must be a positive finite number')
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0) {
    throw new Error('image-mind: backoff.maxDelayMs must be a positive finite number')
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error('image-mind: backoff.initialDelayMs must be less than or equal to maxDelayMs')
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error('image-mind: backoff.jitterRatio must be between 0 and 1')
  }
  return Object.freeze({ initialDelayMs, maxDelayMs, jitterRatio })
}

/**
 * Wait one backoff step with symmetric jitter, abortable. The local delay is
 * `initial * 2^attempt`, capped at `max`, then multiplied by a random factor
 * in `[1-jitterRatio, 1+jitterRatio]`.
 * @param attempt - zero-based retry attempt index.
 * @param backoff - resolved backoff facts.
 * @param signal - caller cancellation; rejects with the abort reason.
 */
export async function sleepBackoff(attempt: number, backoff: ResolvedBackoff, signal?: AbortSignal): Promise<void> {
  const base = Math.min(backoff.initialDelayMs * 2 ** attempt, backoff.maxDelayMs)
  const jitter = 1 - backoff.jitterRatio + Math.random() * 2 * backoff.jitterRatio
  const delay = Math.max(1, Math.round(base * jitter))
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('image-mind: request aborted during retry backoff'))
      return
    }
    const timer = setTimeout(resolve, delay)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('image-mind: request aborted during retry backoff'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
