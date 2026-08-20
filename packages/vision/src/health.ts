/**
 * Provider health scoring primitives.
 *
 * Kept provider-neutral: the runtime can use this to rank recovery
 * candidates without teaching itself vendor-specific behavior.
 * @module @ran-sh/dsh-vision/health
 */

export interface VisionProviderHealthSnapshot {
  successes: number
  failures: number
  consecutiveFailures: number
  totalLatencyMs: number
  lastFailureAt?: number
  openedUntil?: number
}

export interface VisionProviderHealthScore {
  score: number
  healthy: boolean
}

const DEFAULT_COOLDOWN_MS = 30_000

export function createVisionProviderHealth(): VisionProviderHealthSnapshot {
  return { successes: 0, failures: 0, consecutiveFailures: 0, totalLatencyMs: 0 }
}

/**
 * Calculate a bounded score. Success rate dominates; latency and repeated
 * failures only influence ordering, never override explicit routing rules.
 */
export function scoreVisionProviderHealth(
  health: VisionProviderHealthSnapshot,
  now = Date.now(),
): VisionProviderHealthScore {
  const total = health.successes + health.failures
  const successRate = total === 0 ? 1 : health.successes / total
  const averageLatency = health.successes + health.failures === 0
    ? 0
    : health.totalLatencyMs / total
  const penalty = Math.min(0.35, averageLatency / 10000) + Math.min(0.5, health.consecutiveFailures * 0.1)
  const cooldown = health.openedUntil !== undefined && health.openedUntil > now
  return {
    score: Math.max(0, successRate - penalty),
    healthy: !cooldown,
  }
}

export function shouldOpenVisionCircuit(
  health: VisionProviderHealthSnapshot,
  threshold = 3,
): boolean {
  return health.consecutiveFailures >= threshold
}

export function openVisionCircuit(
  health: VisionProviderHealthSnapshot,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
): VisionProviderHealthSnapshot {
  return { ...health, openedUntil: now + cooldownMs }
}
