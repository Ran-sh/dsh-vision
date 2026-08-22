/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VisionRequest } from '@ran-sh/dsh-vision'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/index.ts'
import { createVisionCache } from '../src/cache/vision-cache.ts'
import { ReliabilityVisionAdapter } from '../src/runtime/reliability-adapter.ts'
import { createProviderReliabilityTracker } from '../src/runtime/provider-reliability.ts'

const IMAGE = { bytes: Buffer.from([9, 8, 7]), mimeType: 'image/png' as const }
const REQUEST: VisionRequest = { prompt: 'same semantic request', images: [IMAGE], cache: 'use' }

function ok(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })
}

function unavailable(): Response {
  return new Response('temporarily unavailable', { status: 503 })
}

afterEach(() => vi.unstubAllGlobals())

describe('provider fallback + retry + semantic cache reliability accounting', () => {
  it('does not promote cached backup evidence into a fresh backup health success', async () => {
    const cache = createVisionCache({ ttlMs: 60_000, maxEntries: 8 })
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname
      if (host === 'backup.example') return ok('backup evidence')
      return unavailable()
    })
    vi.stubGlobal('fetch', fetchMock)

    const inner = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: provider => ({
        provider,
        baseURL: `https://${provider}.example/v1`,
        model: 'vision-model',
        apiStyle: 'chat-completions',
        maxOutputTokens: 256,
        timeoutMs: 10_000,
      }),
      resolveApiKey: async options => options.provider === 'primary' ? 'sk-primary-test-key' : 'sk-backup-test-key',
      resolveProviderFallbacks: () => ['backup'],
      cache,
      retry: {
        maxRetries: 1,
        backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
      },
    })

    // Seed the backup semantic-cache namespace without touching reliability
    // state. The later fallback must reuse this exact provider + credential
    // cache entry after the primary exhausts its retry.
    const seeded = await inner.call('backup', { ...REQUEST, provider: 'backup' })
    expect(seeded.provider).toBe('backup')
    expect(seeded.trace).toMatchObject({ providerCalls: 1, cacheHits: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const tracker = createProviderReliabilityTracker()
    const adapter = new ReliabilityVisionAdapter(inner, tracker)
    const result = await adapter.call('primary', REQUEST)

    expect(result.text).toBe('backup evidence')
    expect(result.provider).toBe('backup')
    expect(result.trace).toMatchObject({
      providerCalls: 2,
      retries: 1,
      providerFallbacks: 1,
      cacheHits: 1,
    })

    // Only the two primary attempts were real endpoint traffic. The backup
    // answer came from cache, so it must not receive a synthetic health win.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(tracker.snapshot('primary').health.failures).toBe(1)
    expect(tracker.snapshot('primary').health.successes).toBe(0)
    expect(tracker.snapshot('backup').health.successes).toBe(0)
    expect(tracker.snapshot('backup').health.failures).toBe(0)
  })
})
