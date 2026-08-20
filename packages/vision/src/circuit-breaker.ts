/**
 * Provider circuit breaker primitives.
 *
 * This module intentionally stays provider-neutral. Runtime/adapters decide
 * when an error is circuit-worthy; this file only manages state transitions.
 */

export type VisionCircuitState = 'closed' | 'open' | 'half-open'

export interface VisionCircuitSnapshot {
  state: VisionCircuitState
  failures: number
  openedAt: number | null
  nextProbeAt: number | null
}

export interface VisionCircuitPolicy {
  failureThreshold: number
  cooldownMs: number
}

const DEFAULT_POLICY: VisionCircuitPolicy = {
  failureThreshold: 3,
  cooldownMs: 30_000,
}

export interface VisionCircuitBreaker {
  snapshot(): VisionCircuitSnapshot
  allow(now?: number): boolean
  recordSuccess(now?: number): void
  recordFailure(now?: number): void
}

/**
 * Create a small in-memory breaker suitable for a provider route.
 *
 * State machine:
 * closed -> open after N failures
 * open -> half-open after cooldown
 * half-open -> closed on success, open on failure
 */
export function createVisionCircuitBreaker(
  policy: Partial<VisionCircuitPolicy> = {},
): VisionCircuitBreaker {
  const config = { ...DEFAULT_POLICY, ...policy }
  let state: VisionCircuitState = 'closed'
  let failures = 0
  let openedAt: number | null = null

  function snapshot(): VisionCircuitSnapshot {
    return {
      state,
      failures,
      openedAt,
      nextProbeAt: openedAt === null ? null : openedAt + config.cooldownMs,
    }
  }

  function allow(now = Date.now()): boolean {
    if (state !== 'open') return true
    if (openedAt === null || now < openedAt + config.cooldownMs) return false
    state = 'half-open'
    return true
  }

  function recordSuccess(): void {
    state = 'closed'
    failures = 0
    openedAt = null
  }

  function recordFailure(now = Date.now()): void {
    if (state === 'half-open') {
      state = 'open'
      openedAt = now
      return
    }
    failures += 1
    if (failures >= config.failureThreshold) {
      state = 'open'
      openedAt = now
    }
  }

  return { snapshot, allow, recordSuccess, recordFailure }
}
