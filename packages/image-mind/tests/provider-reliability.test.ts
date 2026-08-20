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

describe('provider reliability tracker', () => {
  it('preserves configured preference before health observations', () => {
    const tracker = createProviderReliabilityTracker()
    expect(tracker.fallbacks(config(), 'primary', {})).toEqual(['first', 'second'])
  })

  it('moves a repeatedly failing backup behind healthier candidates', () => {
    const tracker = createProviderReliabilityTracker()
    tracker.recordFailure('first', 5000)
    tracker.recordFailure('first', 5000)
    expect(tracker.fallbacks(config(), 'primary', {})).toEqual(['second', 'third'])
  })

  it('admits exactly one recovery fallback after circuit cooldown', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    try {
      const tracker = createProviderReliabilityTracker()
      tracker.recordFailure('first', 100)
      tracker.recordFailure('first', 100)
      tracker.recordFailure('first', 100)
      expect(tracker.snapshot('first').circuit.state).toBe('open')
      expect(tracker.fallbacks(config(), 'primary', {})).not.toContain('first')

      vi.setSystemTime(new Date(31_100))
      const recovery = tracker.fallbacks(config(), 'primary', {})
      expect(recovery[0]).toBe('first')
      expect(recovery).toContain('first')
      expect(tracker.snapshot('first').circuit.state).toBe('half-open')

      // The admitted half-open probe is exclusive. A concurrent fallback
      // resolution must not route a second request to the same provider until
      // the first probe records success or failure.
      expect(tracker.fallbacks(config(), 'primary', {})).not.toContain('first')

      tracker.recordSuccess('first', 50)
      expect(tracker.snapshot('first').circuit.state).toBe('closed')
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
