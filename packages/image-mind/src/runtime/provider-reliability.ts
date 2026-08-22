/**
 * Runtime reliability state for configured image-mind providers.
 *
 * The runtime records provider-level outcomes after retry/model-fallback work
 * has finished. This tracker owns only bounded in-memory health/circuit state
 * plus fallback ranking; it never owns endpoint or credential facts.
 */

import {
  createVisionCircuitBreaker,
  createVisionProviderHealth,
  selectVisionProvider,
  type VisionCircuitBreaker,
  type VisionProviderHealthSnapshot,
  type VisionRequest,
} from '@ran-sh/dsh-vision'
import { isProviderComplete, type ResolvedConfig } from '../config.ts'

export const MAX_RELIABILITY_PROVIDER_FALLBACKS = 2

interface ProviderReliabilityState {
  health: VisionProviderHealthSnapshot
  circuit: VisionCircuitBreaker
}

export interface ProviderReliabilitySnapshot {
  provider: string
  health: VisionProviderHealthSnapshot
  circuit: ReturnType<VisionCircuitBreaker['snapshot']>
}

/** One automatic fallback route. Recovery probes must bypass semantic cache. */
export interface ProviderFallbackPlan {
  provider: string
  cache?: 'no-store'
}

export interface ProviderReliabilityTracker {
  recordSuccess(provider: string, latencyMs: number): void
  recordFailure(provider: string, latencyMs: number): void
  /** Close a half-open circuit after a fresh, non-outage provider response. */
  recordReachable(provider: string): void
  /** Release a reserved half-open probe that never reached the provider. */
  releaseProbe(provider: string): void
  fallbacks(config: ResolvedConfig, primaryProvider: string, request: Pick<VisionRequest, 'provider' | 'model'>): ProviderFallbackPlan[]
  snapshot(provider: string): ProviderReliabilitySnapshot
}

function boundedLatency(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10 * 60_000) : 0
}

export function createProviderReliabilityTracker(): ProviderReliabilityTracker {
  const states = new Map<string, ProviderReliabilityState>()

  const stateFor = (provider: string): ProviderReliabilityState => {
    let state = states.get(provider)
    if (state === undefined) {
      state = { health: createVisionProviderHealth(), circuit: createVisionCircuitBreaker() }
      states.set(provider, state)
    }
    return state
  }

  const recordSuccess = (provider: string, latencyMs: number): void => {
    const state = stateFor(provider)
    state.health = {
      ...state.health,
      successes: state.health.successes + 1,
      consecutiveFailures: 0,
      totalLatencyMs: state.health.totalLatencyMs + boundedLatency(latencyMs),
      openedUntil: undefined,
    }
    state.circuit.recordSuccess()
  }

  const recordFailure = (provider: string, latencyMs: number): void => {
    const now = Date.now()
    const state = stateFor(provider)
    state.health = {
      ...state.health,
      failures: state.health.failures + 1,
      consecutiveFailures: state.health.consecutiveFailures + 1,
      totalLatencyMs: state.health.totalLatencyMs + boundedLatency(latencyMs),
      lastFailureAt: now,
    }
    state.circuit.recordFailure(now)
    const circuit = state.circuit.snapshot()
    state.health = {
      ...state.health,
      openedUntil: circuit.state === 'open' && circuit.nextProbeAt !== null
        ? circuit.nextProbeAt
        : state.health.openedUntil,
    }
  }

  const recordReachable = (provider: string): void => {
    const state = stateFor(provider)
    if (state.circuit.snapshot().state !== 'half-open') return
    // A fresh response that is not an outage (for example HTTP 400) proves the
    // endpoint is reachable. Close only the circuit gate; do not inflate
    // successful-request health counters for an application-level failure.
    state.circuit.recordSuccess()
    state.health = { ...state.health, openedUntil: undefined }
  }

  const releaseProbe = (provider: string): void => {
    const state = stateFor(provider)
    if (state.circuit.snapshot().state !== 'half-open') return
    // The reserved probe failed before a provider call (for example credential
    // resolution or caller cancellation). Re-open the gate without counting a
    // provider health failure, so the circuit cannot remain half-open forever.
    const now = Date.now()
    state.circuit.recordFailure(now)
    const circuit = state.circuit.snapshot()
    state.health = {
      ...state.health,
      openedUntil: circuit.state === 'open' && circuit.nextProbeAt !== null
        ? circuit.nextProbeAt
        : state.health.openedUntil,
    }
  }

  const fallbacks = (
    config: ResolvedConfig,
    primaryProvider: string,
    request: Pick<VisionRequest, 'provider' | 'model'>,
  ): ProviderFallbackPlan[] => {
    // Explicit route/model is sticky user intent; never silently substitute.
    if (request.provider !== undefined && request.provider.trim().length > 0) return []
    if (request.model !== undefined && request.model.trim().length > 0) return []

    const candidates: Array<{
      provider: string
      health: VisionProviderHealthSnapshot
      circuit: ReturnType<VisionCircuitBreaker['snapshot']>
      priority: number
    }> = []
    const recoveryProbes: string[] = []
    let fallbackIndex = 0

    for (const [provider, spec] of Object.entries(config.providers)) {
      if (provider === primaryProvider || !isProviderComplete(spec)) continue
      const state = stateFor(provider)
      const before = state.circuit.snapshot()
      const admitted = state.circuit.allow()
      const circuit = state.circuit.snapshot()

      // `allow()` is the concurrency gate for open/half-open circuits. An
      // expired open circuit admits exactly one caller and becomes half-open;
      // concurrent callers must not route another probe to the same provider.
      if (!admitted && circuit.state !== 'closed') {
        fallbackIndex += 1
        continue
      }

      const recoveryProbe = before.state === 'open' && circuit.state === 'half-open'
      if (recoveryProbe) {
        recoveryProbes.push(provider)
        // The health cooldown duplicates circuit state. Once a real half-open
        // probe has been reserved, clear the stale health-only cooldown so the
        // selector does not describe an internally contradictory snapshot.
        state.health = { ...state.health, openedUntil: undefined }
      }

      candidates.push({
        provider,
        health: state.health,
        circuit,
        // Preserve configuration order as a small stable preference while
        // allowing health to dominate after real observations accumulate.
        priority: Math.max(0, 10 - fallbackIndex),
      })
      fallbackIndex += 1
    }

    const selected = selectVisionProvider({ task: 'general', candidates })
    const ranked = selected.ranked.map(item => item.provider)

    // A provider that has just crossed open -> half-open must actually receive
    // its one recovery probe. It is placed first and marked no-store so a stale
    // semantic-cache hit cannot consume the exclusive probe without producing
    // the fresh success/failure needed to settle the circuit.
    const ordered = [
      ...recoveryProbes,
      ...ranked.filter(provider => !recoveryProbes.includes(provider)),
    ]
    return ordered.slice(0, MAX_RELIABILITY_PROVIDER_FALLBACKS).map(provider => ({
      provider,
      ...(recoveryProbes.includes(provider) ? { cache: 'no-store' as const } : {}),
    }))
  }

  const snapshot = (provider: string): ProviderReliabilitySnapshot => {
    const state = stateFor(provider)
    return { provider, health: { ...state.health }, circuit: state.circuit.snapshot() }
  }

  return { recordSuccess, recordFailure, recordReachable, releaseProbe, fallbacks, snapshot }
}
