/**
 * Reliability observation helpers and a generic final-outcome decorator.
 *
 * The production OpenAI-compatible path reports each provider-route attempt
 * directly, which preserves intermediate fallback outcomes. The decorator is
 * retained for adapters that expose only a final result/error.
 */

import { VisionAdapter } from '@ran-sh/dsh-vision'
import type { VisionModel, VisionModelDiscoveryRequest, VisionRequest, VisionResult } from '@ran-sh/dsh-vision'
import type { ProviderAttemptEvent } from '../adapters/openai-compatible/adapter.ts'
import type { ProviderReliabilityTracker } from './provider-reliability.ts'

interface WireLikeError {
  code?: unknown
  status?: unknown
  modelFallbackEligible?: unknown
  cause?: unknown
}

function wireLike(error: unknown): WireLikeError | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    const candidate = current as WireLikeError
    const code = typeof candidate.code === 'string' ? candidate.code : undefined
    // RATE/TIMEOUT/NETWORK are already specific enough. A generic seam-level
    // PROVIDER_ERROR is not: it normally wraps the adapter-local error carrying
    // the concrete HTTP status, so keep walking unless transport detail is
    // actually present on this object.
    if (code === 'RATE_LIMITED' || code === 'TIMEOUT' || code === 'NETWORK_ERROR') return candidate
    if (code === 'PROVIDER_ERROR'
      && (typeof candidate.status === 'number' || typeof candidate.modelFallbackEligible === 'boolean')) {
      return candidate
    }
    current = candidate.cause
  }
  return undefined
}

/** Only endpoint/service failures should degrade provider health. */
export function isProviderReliabilityFailure(error: unknown): boolean {
  const wire = wireLike(error)
  if (wire === undefined || wire.modelFallbackEligible === true) return false
  if (wire.code === 'RATE_LIMITED' || wire.code === 'TIMEOUT' || wire.code === 'NETWORK_ERROR') return true
  if (wire.code !== 'PROVIDER_ERROR') return false
  const status = typeof wire.status === 'number' ? wire.status : undefined
  return status === 413 || (status !== undefined && status >= 500)
}

/**
 * A traced success only proves fresh endpoint health when it actually reached
 * a provider and was not satisfied (fully or partially) from semantic cache.
 * Untraced adapters remain backward-compatible: their successful result is
 * treated as a real call because they expose no cache-work evidence.
 */
export function isFreshProviderSuccess(result: VisionResult): boolean {
  const trace = result.trace
  if (trace === undefined) return true
  return trace.providerCalls > 0 && trace.cacheHits === 0
}

/** Settle one provider-route attempt without inventing health from cache work. */
export function recordProviderAttempt(
  reliability: ProviderReliabilityTracker,
  event: ProviderAttemptEvent,
): void {
  if (event.error === undefined) {
    if (event.providerCalls > 0 && event.cacheHits === 0) {
      reliability.recordSuccess(event.provider, event.elapsedMs)
      return
    }
    // Ordinary cache hits are neutral. If a future regression lets a reserved
    // half-open probe hit cache anyway, release it instead of deadlocking the
    // circuit in half-open forever.
    reliability.releaseProbe(event.provider)
    return
  }

  // Caller cancellation or a failure before any wire call (credential lookup,
  // local setup, etc.) is not provider health evidence. A half-open reservation
  // still has to be released or it would remain exclusive forever.
  if (event.aborted || event.providerCalls === 0) {
    reliability.releaseProbe(event.provider)
    return
  }

  if (isProviderReliabilityFailure(event.error)) {
    reliability.recordFailure(event.provider, event.elapsedMs)
    return
  }

  // A fresh non-outage response (for example HTTP 400/401) proves reachability
  // and can close a half-open circuit without being counted as a successful
  // vision request. Closed circuits ignore this operation.
  reliability.recordReachable(event.provider)
}

export class ReliabilityVisionAdapter extends VisionAdapter {
  readonly discoverModels?: (provider: string, request?: VisionModelDiscoveryRequest) => Promise<readonly VisionModel[]>
  readonly probe?: (provider: string, request: VisionRequest) => Promise<VisionResult>

  constructor(
    private readonly inner: VisionAdapter,
    private readonly reliability: ProviderReliabilityTracker,
  ) {
    super()
    if (inner.discoverModels !== undefined) {
      this.discoverModels = (provider, request) => inner.discoverModels!(provider, request)
    }
    if (inner.probe !== undefined) {
      this.probe = (provider, request) => inner.probe!(provider, request)
    }
  }

  override async call(provider: string, request: VisionRequest): Promise<VisionResult> {
    const started = Date.now()
    try {
      const result = await this.inner.call(provider, request)
      const elapsed = Date.now() - started
      // A different final provider means the wrapped adapter recovered from a
      // provider-level primary failure through its own bounded fallback path.
      if (result.provider !== provider) this.reliability.recordFailure(provider, elapsed)
      // Cache reuse is useful work avoidance, not evidence that the final
      // provider is healthy right now. Do not inflate health from cached data.
      if (isFreshProviderSuccess(result)) this.reliability.recordSuccess(result.provider, elapsed)
      return result
    } catch (error) {
      if (isProviderReliabilityFailure(error)) {
        this.reliability.recordFailure(provider, Date.now() - started)
      }
      throw error
    }
  }
}
