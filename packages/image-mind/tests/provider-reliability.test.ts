/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import { createProviderReliabilityTracker } from '../src/runtime/provider-reliability.ts'
import type { ResolvedConfig } from '../src/config.ts'

function config(): ResolvedConfig {
  const provider = (model: string) => ({
    baseURL: `https://${model}.example/v1`,
    model,
    apiKey: undefined,
    apiKeyEnv: undefined,
    apiStyle: 'chat-completions' as const,
    maxOutputTokens: 1000,
  })
  return {
    providers: { primary: provider('p'), first: provider('a'), second: provider('b'), third: provider('c') },
    active: 'primary',
    defaultPrompt: 'describe',
    maxBytes: 1024,
    timeoutMs: 1000,
    renderImagePreview: true,
    allowPrivateNetwork: false,
  }
}

function ids(plans: ReturnType<ReturnType<typeof createProviderReliabilityTracker>['fallbacks']>): string[] {
  return plans.map(plan => plan.provider)
}

describe('provider reliability tracker', () => {
  it('preserves configured preference before health observations', () => {
    const tracker = createProviderReliabilityTracker()
    expect(ids(tracker.fallbacks(config(), 'primary', {}))).toEqual(['first', 'second'])
  })

  it('moves a repeatedly failing backup behind healthier candidates', () => {
    const tracker = createProviderReliabilityTracker()
    tracker.recordFailure('first', 5000)
    tracker.recordFailure('first', 5000)
    expect(ids(tracker.fallbacks(config(), 'primary', {}))).toEqual(['second', 'third'])
  })

  it('admits exactly one no-store recovery fallback after circuit cooldown', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    try {
      const tracker = createProviderReliabilityTracker()
      tracker.recordFailure('first', 100)
      tracker.recordFailure('first', 100)
      tracker.recordFailure('first', 100)
      expect(tracker.snapshot('first').circuit.state).toBe('open')
      expect(ids(tracker.fallbacks(config(), 'primary', {}))).not.toContain('first')

      vi.setSystemTime(new Date(31_100))
      const recovery = tracker.fallbacks(config(), 'primary', {})
      expect(recovery[0]).toEqual({ provider: 'first', cache: 'no-store' })
      expect(ids(recovery)).toContain('first')
      expect(tracker.snapshot('first').circuit.state).toBe('half-open')

      // The admitted half-open probe is exclusive. A concurrent fallback
      // resolution must not route a second request to the same provider until
      // the first probe records success or failure.
      expect(ids(tracker.fallbacks(config(), 'primary', {}))).not.toContain('first')

      tracker.recordSuccess('first', 50)
      expect(tracker.snapshot('first').circuit.state).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-opens a reserved half-open probe that never reached the provider', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    try {
      const tracker = createProviderReliabilityTracker()
      tracker.recordFailure('first', 100)
      tracker.recordFailure('first', 100)
      tracker.recordFailure('first', 100)
      vi.setSystemTime(new Date(31_100))
      expect(tracker.fallbacks(config(), 'primary', {})[0]).toEqual({ provider: 'first', cache: 'no-store' })
      expect(tracker.snapshot('first').circuit.state).toBe('half-open')

      tracker.releaseProbe('first')
      expect(tracker.snapshot('first').circuit.state).toBe('open')
      expect(tracker.snapshot('first').health.failures).toBe(3)

      vi.setSystemTime(new Date(61_200))
      expect(tracker.fallbacks(config(), 'primary', {})[0]).toEqual({ provider: 'first', cache: 'no-store' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes half-open on a fresh reachable non-outage response without inventing a success', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    try {
      const tracker = createProviderReliabilityTracker()
      tracker.recordFailure('first', 100)
      tracker.recordFailure('first', 100)
      tracker.recordFailure('first', 100)
      vi.setSystemTime(new Date(31_100))
      tracker.fallbacks(config(), 'primary', {})
      expect(tracker.snapshot('first').circuit.state).toBe('half-open')

      tracker.recordReachable('first')
      const snapshot = tracker.snapshot('first')
      expect(snapshot.circuit.state).toBe('closed')
      expect(snapshot.health.successes).toBe(0)
      expect(snapshot.health.failures).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('success resets the failure streak and closes the circuit', () => {
    const tracker = createProviderReliabilityTracker()
    tracker.recordFailure('first', 100)
    tracker.recordFailure('first', 100)
    tracker.recordFailure('first', 100)
    tracker.recordSuccess('first', 50)
    const snapshot = tracker.snapshot('first')
    expect(snapshot.circuit.state).toBe('closed')
    expect(snapshot.health.consecutiveFailures).toBe(0)
    expect(snapshot.health.successes).toBe(1)
  })

  it('never returns automatic backups for explicit provider or model intent', () => {
    const tracker = createProviderReliabilityTracker()
    expect(tracker.fallbacks(config(), 'primary', { provider: 'primary' })).toEqual([])
    expect(tracker.fallbacks(config(), 'primary', { model: 'manual-model' })).toEqual([])
  })
})

describe('half-open reservation at selection (no stranded probes)', () => {
  it('never reserves more half-open probes than returned fallback plans', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    try {
      const tracker = createProviderReliabilityTracker()
      // Open all three backups.
      for (const provider of ['first', 'second', 'third']) {
        tracker.recordFailure(provider, 100)
        tracker.recordFailure(provider, 100)
        tracker.recordFailure(provider, 100)
        expect(tracker.snapshot(provider).circuit.state).toBe('open')
      }
      // Cooldown expires for all three.
      vi.setSystemTime(new Date(1000 + 31_000))

      const plans = tracker.fallbacks(config(), 'primary', {})
      expect(plans).toHaveLength(2)

      // Exactly the two returned providers are half-open; the unselected
      // third stays open (never stranded in half-open with no request).
      const halfOpen = ['first', 'second', 'third'].filter(
        provider => tracker.snapshot(provider).circuit.state === 'half-open',
      )
      expect(halfOpen).toHaveLength(2)
      const unselected = ['first', 'second', 'third'].find(
        provider => !plans.some(plan => plan.provider === provider),
      )!
      expect(tracker.snapshot(unselected).circuit.state).toBe('open')
      // Every returned recovery plan is no-store.
      expect(plans.every(plan => plan.cache === 'no-store')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an unselected probe-ready provider remains recoverable on a later call', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    try {
      const tracker = createProviderReliabilityTracker()
      for (const provider of ['first', 'second', 'third']) {
        tracker.recordFailure(provider, 100)
        tracker.recordFailure(provider, 100)
        tracker.recordFailure(provider, 100)
      }
      vi.setSystemTime(new Date(1000 + 31_000))

      const firstPlans = tracker.fallbacks(config(), 'primary', {})
      // Settle the two probes that were admitted.
      for (const plan of firstPlans) tracker.recordSuccess(plan.provider, 50)

      // The previously unselected third provider can now get its probe.
      const unselected = ['first', 'second', 'third'].find(
        provider => !firstPlans.some(plan => plan.provider === provider),
      )!
      const secondPlans = tracker.fallbacks(config(), 'primary', {})
      expect(secondPlans.some(plan => plan.provider === unselected && plan.cache === 'no-store')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('concurrent planning admits a half-open provider only once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    try {
      const tracker = createProviderReliabilityTracker()
      for (const provider of ['first', 'second', 'third']) {
        tracker.recordFailure(provider, 100)
        tracker.recordFailure(provider, 100)
        tracker.recordFailure(provider, 100)
      }
      vi.setSystemTime(new Date(1000 + 31_000))

      const planA = tracker.fallbacks(config(), 'primary', {})
      const planB = tracker.fallbacks(config(), 'primary', {})

      // Across two planners, the same provider never appears as a recovery
      // probe twice.
      const probeA = new Set(planA.filter(plan => plan.cache === 'no-store').map(plan => plan.provider))
      const probeB = new Set(planB.filter(plan => plan.cache === 'no-store').map(plan => plan.provider))
      for (const provider of probeA) expect(probeB.has(provider)).toBe(false)
      // Together they may still fill the full two-slot fallback budget.
      expect(planA.length + planB.length).toBeGreaterThanOrEqual(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
