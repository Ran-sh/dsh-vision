/**
 * Runtime reliability state for configured image-mind providers.
 *
 * The OpenAI-compatible adapter tells this tracker only about provider-level
 * outcomes after its internal retry/model-fallback path has finished. The
 * tracker owns no endpoint/credential facts; it keeps bounded in-memory
 * health/circuit state and uses the provider-neutral selector to rank backup
 * routes.
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

export interface ProviderReliabilityTracker {
  recordSuccess(provider: string, latencyMs: number): void
  recordFailure(provider: string, latencyMs: number): void
  fallbacks(config: ResolvedConfig, primaryProvider: string, request: Pick<VisionRequest, 'provider' | 'model'>): string[]
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

  const fallbacks = (
    config: ResolvedConfig,
    primaryProvider: string,
    request: Pick<VisionRequest, 'provider' | 'model'>,
  ): string[] => {
    // Explicit route/model is sticky user intent; never silently substitute.
    if (request.provider !== undefined && request.provider.trim().length > 0) return []
    if (request.model !== undefined && request.model.trim().length > 0) return []

    const candidates = Object.entries(config.providers)
      .filter(([id, spec]) => id !== primaryProvider && isProviderComplete(spec))
      .map(([provider], index) => {
        const state = stateFor(provider)
        // `allow` advances an expired open circuit into half-open so one
        // recovery probe can re-enter selection after cooldown.
        state.circuit.allow()
        return {
          provider,
          health: state.health,
          circuit: state.circuit.snapshot(),
          // Preserve configuration order as a small stable preference while
          // allowing health to dominate after real observations accumulate.
          priority: Math.max(0, 10 - index),
        }
      })

    const selected = selectVisionProvider({ task: 'general', candidates })
    return selected.ranked.slice(0, MAX_RELIABILITY_PROVIDER_FALLBACKS).map(item => item.provider)
  }

  const snapshot = (provider: string): ProviderReliabilitySnapshot => {
    const state = stateFor(provider)
    return { provider, health: { ...state.health }, circuit: state.circuit.snapshot() }
  }

  return { recordSuccess, recordFailure, fallbacks, snapshot }
}
