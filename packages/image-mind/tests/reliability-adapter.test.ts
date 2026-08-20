/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { VisionAdapter, VisionError } from '@ran-sh/dsh-vision'
import type { VisionRequest, VisionResult } from '@ran-sh/dsh-vision'
import { createProviderReliabilityTracker } from '../src/runtime/provider-reliability.ts'
import { ReliabilityVisionAdapter, isProviderReliabilityFailure } from '../src/runtime/reliability-adapter.ts'

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

describe('provider reliability failure classification', () => {
  it('tracks endpoint/service failures but not deterministic client failures', () => {
    expect(isProviderReliabilityFailure(providerFailure(503))).toBe(true)
    expect(isProviderReliabilityFailure(providerFailure(413))).toBe(true)
    expect(isProviderReliabilityFailure(providerFailure(400))).toBe(false)
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

  it('records primary failure and final fallback success when wrapped adapter reroutes', async () => {
    const tracker = createProviderReliabilityTracker()
    const adapter = new ReliabilityVisionAdapter(
      new StubAdapter(async () => ({ text: 'ok', provider: 'backup', model: 'm' })),
      tracker,
    )
    await adapter.call('primary', request)
    expect(tracker.snapshot('primary').health.failures).toBe(1)
    expect(tracker.snapshot('backup').health.successes).toBe(1)
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
