/**
 * Provider-neutral vision selection policy.
 *
 * This module composes task intent, provider health, and circuit state into a
 * deterministic ranking. It does not know endpoints, credentials, pricing,
 * vendor names, or HTTP semantics. Explicit provider choice remains an
 * instruction: the selector never silently replaces it.
 */

import { scoreVisionProviderHealth, type VisionProviderHealthSnapshot } from './health.ts'
import type { VisionCircuitSnapshot } from './circuit-breaker.ts'
import type { VisionTask } from './task-router.ts'

export interface VisionSelectionCandidate {
  /** Registered provider route id. */
  provider: string
  /** Rolling provider-neutral health counters. */
  health: VisionProviderHealthSnapshot
  /** Current circuit state for this provider route. */
  circuit: VisionCircuitSnapshot
  /** Optional task capabilities known by the registrant. Empty/absent = unknown. */
  tasks?: readonly VisionTask[]
  /** Stable operator/config priority. Higher wins only after availability. */
  priority?: number
}

export type VisionSelectionSkipReason = 'circuit-open' | 'task-unsupported'

export interface VisionRankedCandidate {
  provider: string
  score: number
  reason: 'explicit' | 'ranked'
}

export interface VisionSkippedCandidate {
  provider: string
  reason: VisionSelectionSkipReason
}

export interface VisionSelectionResult {
  /** Best eligible provider; absent means no candidate can be used now. */
  selected?: VisionRankedCandidate
  /** All eligible automatic candidates in deterministic best-first order. */
  ranked: VisionRankedCandidate[]
  /** Candidates excluded before ranking, with stable machine reasons. */
  skipped: VisionSkippedCandidate[]
}

/** A circuit remains unavailable until its next probe time. */
function circuitAvailable(circuit: VisionCircuitSnapshot, now: number): boolean {
  if (circuit.state !== 'open') return true
  return circuit.nextProbeAt !== null && now >= circuit.nextProbeAt
}

/** Whether a candidate explicitly declares that it cannot serve this task. */
function taskUnsupported(candidate: VisionSelectionCandidate, task: VisionTask): boolean {
  return candidate.tasks !== undefined && candidate.tasks.length > 0 && !candidate.tasks.includes(task)
}

/**
 * Deterministically select/rank providers.
 *
 * Automatic ranking:
 * - reject circuits still cooling down;
 * - reject providers that explicitly declare the task unsupported;
 * - health score is the primary dynamic signal;
 * - exact task capability gets a small confidence boost;
 * - configured priority is a bounded tie-break signal;
 * - half-open probes receive a penalty so healthy closed routes win first;
 * - provider id is the final stable tie-breaker.
 *
 * Explicit provider selection never reroutes to another provider. If the
 * explicit provider is unavailable, `selected` is absent and the matching
 * skip reason is returned instead of silently choosing a different route.
 */
export function selectVisionProvider(options: {
  task: VisionTask
  candidates: readonly VisionSelectionCandidate[]
  explicitProvider?: string
  now?: number
}): VisionSelectionResult {
  const now = options.now ?? Date.now()
  const explicit = options.explicitProvider?.trim()

  if (explicit !== undefined && explicit.length > 0) {
    const candidate = options.candidates.find(item => item.provider === explicit)
    if (candidate === undefined) return { ranked: [], skipped: [] }
    if (!circuitAvailable(candidate.circuit, now)) {
      return { ranked: [], skipped: [{ provider: explicit, reason: 'circuit-open' }] }
    }
    if (taskUnsupported(candidate, options.task)) {
      return { ranked: [], skipped: [{ provider: explicit, reason: 'task-unsupported' }] }
    }
    const selected = { provider: explicit, score: scoreVisionProviderHealth(candidate.health, now).score, reason: 'explicit' as const }
    return { selected, ranked: [selected], skipped: [] }
  }

  const ranked: VisionRankedCandidate[] = []
  const skipped: VisionSkippedCandidate[] = []

  for (const candidate of options.candidates) {
    if (!circuitAvailable(candidate.circuit, now)) {
      skipped.push({ provider: candidate.provider, reason: 'circuit-open' })
      continue
    }
    if (taskUnsupported(candidate, options.task)) {
      skipped.push({ provider: candidate.provider, reason: 'task-unsupported' })
      continue
    }

    const health = scoreVisionProviderHealth(candidate.health, now).score
    const taskBoost = candidate.tasks?.includes(options.task) === true ? 0.08 : 0
    const priorityBoost = Math.max(-0.1, Math.min(0.1, (candidate.priority ?? 0) * 0.01))
    const halfOpenPenalty = candidate.circuit.state === 'half-open' ? 0.12 : 0
    ranked.push({
      provider: candidate.provider,
      score: Math.max(0, health + taskBoost + priorityBoost - halfOpenPenalty),
      reason: 'ranked',
    })
  }

  ranked.sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider))
  return { selected: ranked[0], ranked, skipped }
}
