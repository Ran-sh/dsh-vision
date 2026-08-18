/**
 * Retry-After tests: seconds and HTTP-date parsing, the 15s cap, and the
 * retry loop honoring a provider-requested delay over the backoff schedule.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OpenAICompatibleVisionAdapter, parseRetryAfter, MAX_RETRY_AFTER_MS,
} from '../src/adapters/openai-compatible/adapter.ts'
import type { OpenAICompatibleVisionOptions } from '../src/adapters/openai-compatible/types.ts'

const IMAGE = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }
const REQUEST = { prompt: 'p', images: [IMAGE] }

function connection(overrides: Partial<OpenAICompatibleVisionOptions> = {}): OpenAICompatibleVisionOptions {
  return {
    provider: 'p',
    baseURL: 'https://api.example.com/v1',
    model: 'm',
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 10_000,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('parseRetryAfter', () => {
  it('parses integer seconds', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('parses HTTP-date', () => {
    const future = new Date(Date.now() + 5000).toUTCString()
    const parsed = parseRetryAfter(future)
    expect(parsed).toBeGreaterThan(0)
    expect(parsed).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS)
  })

  it('caps absurd values at MAX_RETRY_AFTER_MS (never hour-long stalls)', () => {
    expect(parseRetryAfter('3600')).toBe(MAX_RETRY_AFTER_MS)
    expect(parseRetryAfter('999999')).toBe(MAX_RETRY_AFTER_MS)
  })

  it('returns undefined for unparseable input (falls back to backoff)', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('later')).toBeUndefined()
    expect(parseRetryAfter('')).toBeUndefined()
  })
})

describe('adapter honors Retry-After', () => {
  it('waits max(backoff, retryAfter) before the retry', async () => {
    vi.useFakeTimers()
    // First attempt: 429 with Retry-After: 2 (2000ms > 100ms backoff).
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{}}', {
        status: 429,
        headers: { 'retry-after': '2', 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: () => connection(),
      resolveApiKey: async () => 'sk',
      retry: { maxRetries: 1, backoff: { initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 } },
    })
    const promise = adapter.call('p', REQUEST)
    // 100ms backoff would have fired by 150ms; Retry-After 2s must still wait.
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // After the full 2s the retry fires.
    await vi.advanceTimersByTimeAsync(1600)
    const result = await promise
    expect(result.text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caps a huge Retry-After at MAX_RETRY_AFTER_MS', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{}}', {
        status: 429,
        headers: { 'retry-after': '3600', 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAICompatibleVisionAdapter({
      resolveProviderOptions: () => connection(),
      resolveApiKey: async () => 'sk',
      retry: { maxRetries: 1, backoff: { initialDelayMs: 10, maxDelayMs: 10, jitterRatio: 0 } },
    })
    const promise = adapter.call('p', REQUEST)
    // Well past the 10ms backoff, still before the 15s cap: no retry yet.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // At the cap the retry fires.
    await vi.advanceTimersByTimeAsync(MAX_RETRY_AFTER_MS)
    const result = await promise
    expect(result.text).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
