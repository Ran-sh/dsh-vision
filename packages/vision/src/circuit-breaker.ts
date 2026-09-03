/**
 * Provider circuit breaker primitives.
 *
 * This module intentionally stays provider-neutral. Runtime/adapters decide
 * when an error is circuit-worthy; this file only manages state transitions.
 */

export type VisionCircuitState = 'closed' | 'open' | 'half-open'
export type VisionCircuitAdmission = 'closed' | 'probe-ready' | 'blocked'

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
  /** Side-effect-free admission query; `allow()` is the only mutating gate. */
  admission(now?: number): VisionCircuitAdmission
  allow(now?: number): boolean
  recordSuccess(now?: number): void
  recordFailure(now?: number): void
}

function validatePolicy(policy: VisionCircuitPolicy): VisionCircuitPolicy {
  if (!Number.isSafeInteger(policy.failureThreshold) || policy.failureThreshold <= 0) {
    throw new Error('vision: circuit failureThreshold must be a positive safe integer')
  }
  if (!Number.isSafeInteger(policy.cooldownMs) || policy.cooldownMs < 0) {
    throw new Error('vision: circuit cooldownMs must be a non-negative safe integer')
  }
  return policy
}

/**
 * Create a small in-memory breaker suitable for a provider route.
 *
 * State machine:
 * closed -> open after N failures
 * open -> half-open after cooldown (exactly one admitted probe)
 * half-open -> closed on success, open on failure
 */
export function createVisionCircuitBreaker(
  policy: Partial<VisionCircuitPolicy> = {},
): VisionCircuitBreaker {
  const config = validatePolicy({ ...DEFAULT_POLICY, ...policy })
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

  function admission(now = Date.now()): VisionCircuitAdmission {
    if (state === 'closed') return 'closed'
    if (state === 'half-open') return 'blocked'
    if (openedAt !== null && now >= openedAt + config.cooldownMs) return 'probe-ready'
    return 'blocked'
  }

  function allow(now = Date.now()): boolean {
    if (state === 'closed') return true
    // A half-open state means the one recovery probe is already admitted.
    // Until that probe records success/failure, every concurrent caller must
    // stay out or the breaker ceases to provide isolation.
    if (state === 'half-open') return false
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

  return { snapshot, admission, allow, recordSuccess, recordFailure }
}
