/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { VisionAdapter, VisionError } from '@ran-sh/dsh-vision'
import type { VisionRequest, VisionResult, VisionTrace } from '@ran-sh/dsh-vision'
import { createProviderReliabilityTracker } from '../src/runtime/provider-reliability.ts'
import {
  ReliabilityVisionAdapter,
  isFreshProviderSuccess,
  isProviderReliabilityFailure,
} from '../src/runtime/reliability-adapter.ts'

class StubAdapter extends VisionAdapter {
  constructor(private readonly run: (provider: string) => Promise<VisionResult>) { super() }
  override call(provider: string, _request: VisionRequest): Promise<VisionResult> { return this.run(provider) }
}

const request: VisionRequest = { prompt: 'p', images: [] }

function providerFailure(status: number): VisionError {
  const wire = Object.assign(new Error(`HTTP ${status}`), {
    code: 'PROVIDER_ERROR',
    status,
    modelFallbackEligible: false,
  })
  return new VisionError(`HTTP ${status}`, 'PROVIDER_ERROR', { cause: wire })
}

function trace(overrides: Partial<VisionTrace> = {}): VisionTrace {
  return {
    providerCalls: 1,
    payloadBytes: 1,
    cacheHits: 0,
    retries: 0,
    modelFallbacks: 0,
    providerFallbacks: 0,
    splits: 0,
    ...overrides,
  }
}

describe('provider reliability failure classification', () => {
  it('tracks endpoint/service failures but not deterministic client failures', () => {
    expect(isProviderReliabilityFailure(providerFailure(503))).toBe(true)
    expect(isProviderReliabilityFailure(providerFailure(413))).toBe(true)
    expect(isProviderReliabilityFailure(providerFailure(400))).toBe(false)
  })
})

describe('provider reliability success classification', () => {
  it('accepts fresh traced calls and legacy untraced successes', () => {
    expect(isFreshProviderSuccess({ text: 'ok', provider: 'p', model: 'm' })).toBe(true)
    expect(isFreshProviderSuccess({ text: 'ok', provider: 'p', model: 'm', trace: trace() })).toBe(true)
  })

  it('rejects direct or partial semantic-cache successes as fresh health evidence', () => {
    expect(isFreshProviderSuccess({
      text: 'cached', provider: 'p', model: 'm',
      trace: trace({ providerCalls: 0, payloadBytes: 0, cacheHits: 1 }),
    })).toBe(false)
    expect(isFreshProviderSuccess({
      text: 'mixed', provider: 'p', model: 'm',
      trace: trace({ providerCalls: 1, cacheHits: 1 }),
    })).toBe(false)
  })
})

describe('ReliabilityVisionAdapter', () => {
  it('records a normal successful provider call', async () => {
    const tracker = createProviderReliabilityTracker()
    const adapter = new ReliabilityVisionAdapter(
      new StubAdapter(async provider => ({ text: 'ok', provider, model: 'm' })),
      tracker,
    )
    await adapter.call('primary', request)
    expect(tracker.snapshot('primary').health.successes).toBe(1)
    expect(tracker.snapshot('primary').health.failures).toBe(0)
  })

  it('records primary failure and final fallback success when backup was actually called', async () => {
    const tracker = createProviderReliabilityTracker()
    const adapter = new ReliabilityVisionAdapter(
      new StubAdapter(async () => ({
        text: 'ok', provider: 'backup', model: 'm',
        trace: trace({ providerCalls: 2, providerFallbacks: 1 }),
      })),
      tracker,
    )
    await adapter.call('primary', request)
    expect(tracker.snapshot('primary').health.failures).toBe(1)
    expect(tracker.snapshot('backup').health.successes).toBe(1)
  })

  it('does not count a direct cache hit as fresh provider health', async () => {
    const tracker = createProviderReliabilityTracker()
    const adapter = new ReliabilityVisionAdapter(
      new StubAdapter(async provider => ({
        text: 'cached', provider, model: 'm',
        trace: trace({ providerCalls: 0, payloadBytes: 0, cacheHits: 1 }),
      })),
      tracker,
    )

    await adapter.call('primary', request)
    expect(tracker.snapshot('primary').health.successes).toBe(0)
    expect(tracker.snapshot('primary').health.failures).toBe(0)
  })

  it('records the real primary failure but not a fake backup success when fallback hits cache', async () => {
    const tracker = createProviderReliabilityTracker()
    const adapter = new ReliabilityVisionAdapter(
      new StubAdapter(async () => ({
        text: 'cached backup', provider: 'backup', model: 'm',
        trace: trace({ providerCalls: 1, cacheHits: 1, providerFallbacks: 1 }),
      })),
      tracker,
    )

    await adapter.call('primary', request)
    expect(tracker.snapshot('primary').health.failures).toBe(1)
    expect(tracker.snapshot('backup').health.successes).toBe(0)
    expect(tracker.snapshot('backup').health.failures).toBe(0)
  })

  it('records only provider-level terminal failures', async () => {
    const tracker = createProviderReliabilityTracker()
    const failing = new ReliabilityVisionAdapter(
      new StubAdapter(async () => { throw providerFailure(503) }),
      tracker,
    )
    await expect(failing.call('primary', request)).rejects.toThrow()
    expect(tracker.snapshot('primary').health.failures).toBe(1)

    const clientError = new ReliabilityVisionAdapter(
      new StubAdapter(async () => { throw providerFailure(400) }),
      tracker,
    )
    await expect(clientError.call('client', request)).rejects.toThrow()
    expect(tracker.snapshot('client').health.failures).toBe(0)
  })
})
