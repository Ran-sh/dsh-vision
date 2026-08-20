/**
 * Reliability decorator for a vision adapter.
 *
 * It deliberately does not own retries, fallback, endpoints, credentials, or
 * selection. It observes the final outcome of the wrapped adapter and records
 * only provider-level reliability signals in the tracker.
 */

import { VisionAdapter } from '@ran-sh/dsh-vision'
import type { VisionModel, VisionModelDiscoveryRequest, VisionRequest, VisionResult } from '@ran-sh/dsh-vision'
import type { ProviderReliabilityTracker } from './provider-reliability.ts'

interface WireLikeError {
  code?: unknown
  status?: unknown
  modelFallbackEligible?: unknown
  cause?: unknown
}

function wireLike(error: unknown): WireLikeError | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    const candidate = current as WireLikeError
    if (typeof candidate.code === 'string'
      && ['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_ERROR'].includes(candidate.code)) {
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
      this.reliability.recordSuccess(result.provider, elapsed)
      return result
    } catch (error) {
      if (isProviderReliabilityFailure(error)) {
        this.reliability.recordFailure(provider, Date.now() - started)
      }
      throw error
    }
  }
}
