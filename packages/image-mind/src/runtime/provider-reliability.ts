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
      admission: 'closed' | 'probe-ready' | 'blocked'
      priority: number
    }> = []
    let fallbackIndex = 0

    for (const [provider, spec] of Object.entries(config.providers)) {
      if (provider === primaryProvider || !isProviderComplete(spec)) continue
      const state = stateFor(provider)
      candidates.push({
        provider,
        health: state.health,
        circuit: state.circuit.snapshot(),
        admission: state.circuit.admission(),
        // Preserve configuration order as a small stable preference while
        // allowing health to dominate after real observations accumulate.
        priority: Math.max(0, 10 - fallbackIndex),
      })
      fallbackIndex += 1
    }

    const selected = selectVisionProvider({ task: 'general', candidates })
    const ranked = selected.ranked
      .map(item => candidates.find(candidate => candidate.provider === item.provider))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)

    // Phase 2: fill at most MAX fallback slots; reserve a half-open probe
    // (allow()) only for a route that is actually returned. A provider that
    // just crossed open -> half-open must actually receive its one recovery
    // probe, so it is placed first and marked no-store so a stale semantic
    // cache hit cannot consume the exclusive probe without settling it.
    const plans: ProviderFallbackPlan[] = []
    const ordered = [
      ...ranked.filter(candidate => candidate.admission === 'probe-ready'),
      ...ranked.filter(candidate => candidate.admission !== 'probe-ready'),
    ]
    for (const candidate of ordered) {
      if (plans.length >= MAX_RELIABILITY_PROVIDER_FALLBACKS) break
      const provider = candidate.provider
      const state = stateFor(provider)

      if (candidate.admission === 'probe-ready' || state.circuit.snapshot().state === 'open') {
        // This is the commit point for the exclusive probe. If a concurrent
        // planner won the reservation first, skip and keep filling.
        if (!state.circuit.allow()) continue
        // Once a real half-open probe has been reserved, clear the stale
        // health-only cooldown so the selector does not describe an
        // internally contradictory snapshot.
        state.health = { ...state.health, openedUntil: undefined }
        plans.push({ provider, cache: 'no-store' })
        continue
      }

      plans.push({ provider })
    }
    return plans
  }

  const snapshot = (provider: string): ProviderReliabilitySnapshot => {
    const state = stateFor(provider)
    return { provider, health: { ...state.health }, circuit: state.circuit.snapshot() }
  }

  return { recordSuccess, recordFailure, recordReachable, releaseProbe, fallbacks, snapshot }
}
