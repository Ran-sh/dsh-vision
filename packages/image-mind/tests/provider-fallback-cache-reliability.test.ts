/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VisionRequest } from '@ran-sh/dsh-vision'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/index.ts'
import { createVisionCache } from '../src/cache/vision-cache.ts'
import type { ResolvedConfig } from '../src/config.ts'
import { createProviderReliabilityTracker } from '../src/runtime/provider-reliability.ts'
import { recordProviderAttempt } from '../src/runtime/reliability-adapter.ts'

const IMAGE = { bytes: Buffer.from([9, 8, 7]), mimeType: 'image/png' as const }
const REQUEST: VisionRequest = { prompt: 'same semantic request', images: [IMAGE], cache: 'use' }

function ok(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })
}

function unavailable(): Response {
  return new Response('temporarily unavailable', { status: 503 })
}

function reliabilityConfig(): ResolvedConfig {
  const provider = (name: string) => ({
    baseURL: `https://${name}.example/v1`,
    model: 'vision-model',
    apiKey: undefined,
    apiKeyEnv: undefined,
    apiStyle: 'chat-completions' as const,
    maxOutputTokens: 256,
  })
  return {
    providers: { primary: provider('primary'), backup: provider('backup') },
    active: 'primary',
    defaultPrompt: 'describe',
    maxBytes: 1024,
    timeoutMs: 10_000,
    renderImagePreview: true,
    allowPrivateNetwork: false,
  }
}

function options(provider: string) {
  return {
    provider,
    baseURL: `https://${provider}.example/v1`,
    model: 'vision-model',
    apiStyle: 'chat-completions' as const,
    maxOutputTokens: 256,
    timeoutMs: 10_000,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('provider fallback + retry + semantic cache reliability accounting', () => {
  it('does not promote cached backup evidence into a fresh backup health success', async () => {
    const cache = createVisionCache({ ttlMs: 60_000, maxEntries: 8 })
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname
      if (host === 'backup.example') return ok('backup evidence')
      return unavailable()
    })
    vi.stubGlobal('fetch', fetchMock)

    // Seed backup cache without touching reliability state.
    const seed = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: provider => options(provider),
      resolveApiKey: async provider => provider.provider === 'primary' ? 'sk-primary-test-key' : 'sk-backup-test-key',
      cache,
      retry: { maxRetries: 0 },
    })
    const seeded = await seed.call('backup', { ...REQUEST, provider: 'backup' })
    expect(seeded.provider).toBe('backup')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const tracker = createProviderReliabilityTracker()
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: provider => options(provider),
      resolveApiKey: async provider => provider.provider === 'primary' ? 'sk-primary-test-key' : 'sk-backup-test-key',
      resolveProviderFallbacks: () => ['backup'],
      onProviderAttempt: event => recordProviderAttempt(tracker, event),
      cache,
      retry: {
        maxRetries: 1,
        backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
      },
    })

    const result = await adapter.call('primary', REQUEST)
    expect(result.text).toBe('backup evidence')
    expect(result.provider).toBe('backup')
    expect(result.trace).toMatchObject({
      providerCalls: 2,
      retries: 1,
      providerFallbacks: 1,
      cacheHits: 1,
    })

    // Only the two primary attempts were fresh endpoint traffic. The backup
    // answer came from cache, so it must not receive a synthetic health win.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(tracker.snapshot('primary').health.failures).toBe(1)
    expect(tracker.snapshot('primary').health.successes).toBe(0)
    expect(tracker.snapshot('backup').health.successes).toBe(0)
    expect(tracker.snapshot('backup').health.failures).toBe(0)
  })

  it('records an intermediate fallback failure before a later fallback succeeds', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname
      if (host === 'second.example') return ok('second recovered')
      return unavailable()
    })
    vi.stubGlobal('fetch', fetchMock)

    const tracker = createProviderReliabilityTracker()
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: provider => options(provider),
      resolveApiKey: async provider => `sk-${provider.provider}-test-key`,
      resolveProviderFallbacks: () => ['first', 'second'],
      onProviderAttempt: event => recordProviderAttempt(tracker, event),
      retry: { maxRetries: 0 },
    })

    const result = await adapter.call('primary', REQUEST)
    expect(result.text).toBe('second recovered')
    expect(result.provider).toBe('second')
    expect(result.trace).toMatchObject({ providerCalls: 3, providerFallbacks: 2, cacheHits: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    expect(tracker.snapshot('primary').health.failures).toBe(1)
    expect(tracker.snapshot('first').health.failures).toBe(1)
    expect(tracker.snapshot('first').health.successes).toBe(0)
    expect(tracker.snapshot('second').health.successes).toBe(1)
  })

  it('forces a half-open recovery fallback past a warm semantic cache', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    const cache = createVisionCache({ ttlMs: 120_000, maxEntries: 8 })
    let backupCalls = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname
      if (host === 'primary.example') return unavailable()
      if (host === 'backup.example') {
        backupCalls += 1
        return ok(backupCalls === 1 ? 'cached-old' : 'fresh-recovery')
      }
      return unavailable()
    })
    vi.stubGlobal('fetch', fetchMock)

    const seed = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: provider => options(provider),
      resolveApiKey: async provider => `sk-${provider.provider}-test-key`,
      cache,
      retry: { maxRetries: 0 },
    })
    expect((await seed.call('backup', { ...REQUEST, provider: 'backup' })).text).toBe('cached-old')
    expect(backupCalls).toBe(1)

    const tracker = createProviderReliabilityTracker()
    tracker.recordFailure('backup', 100)
    tracker.recordFailure('backup', 100)
    tracker.recordFailure('backup', 100)
    expect(tracker.snapshot('backup').circuit.state).toBe('open')

    vi.setSystemTime(new Date(31_100))
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: provider => options(provider),
      resolveApiKey: async provider => `sk-${provider.provider}-test-key`,
      resolveProviderFallbacks: (provider, request) => tracker.fallbacks(reliabilityConfig(), provider, request),
      onProviderAttempt: event => recordProviderAttempt(tracker, event),
      cache,
      retry: { maxRetries: 0 },
    })

    const result = await adapter.call('primary', REQUEST)
    expect(result.text).toBe('fresh-recovery')
    expect(result.provider).toBe('backup')
    expect(result.trace).toMatchObject({ providerCalls: 2, providerFallbacks: 1, cacheHits: 0 })
    expect(backupCalls).toBe(2)

    const backup = tracker.snapshot('backup')
    expect(backup.circuit.state).toBe('closed')
    expect(backup.health.successes).toBe(1)
    expect(backup.health.consecutiveFailures).toBe(0)
  })

  it('releases a half-open reservation when credential resolution fails before a provider call', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1000))
    const tracker = createProviderReliabilityTracker()
    tracker.recordFailure('backup', 100)
    tracker.recordFailure('backup', 100)
    tracker.recordFailure('backup', 100)
    vi.setSystemTime(new Date(31_100))

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname
      if (host === 'primary.example') return unavailable()
      return ok('unexpected')
    }))

    const adapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: provider => options(provider),
      resolveApiKey: async provider => {
        if (provider.provider === 'backup') throw new Error('missing test credential')
        return 'sk-primary-test-key'
      },
      resolveProviderFallbacks: (provider, request) => tracker.fallbacks(reliabilityConfig(), provider, request),
      onProviderAttempt: event => recordProviderAttempt(tracker, event),
      retry: { maxRetries: 0 },
    })

    await expect(adapter.call('primary', REQUEST)).rejects.toThrow('missing test credential')
    const backup = tracker.snapshot('backup')
    expect(backup.circuit.state).toBe('open')
    expect(backup.health.failures).toBe(3)
    expect(backup.health.successes).toBe(0)
  })
})
