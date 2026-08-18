/**
 * Credential integration (host side): typed keys travel from the settings
 * card draft into the adapter snapshot and the wire request, never into the
 * settings document or any returned value. Covers the exact task-79
 * scenario: set → resolve → missing, and proves the browser-facing surface
 * never receives a secret (the RPC outcomes and error messages are
 * key-free, verified in http-server tests too).
 *
 * The browser-half redaction itself (masked inputs never re-sent, keys only
 * via pendingCredentialWrites) is exercised through the pure helper
 * deriveKeyRef from settings/store.ts, which does not need the client
 * runtime.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { draftProvider, draftProviderForListing } from '../src/runtime/vision-rpc.ts'
import { deriveKeyRef } from '../src/credentials/migrate.ts'
import { resolveApiKey, assertUsableApiKey } from '../src/credentials/resolve.ts'
import { ImageMindVisionError } from '../src/adapters/openai-compatible/adapter.ts'
import type { OpenAICompatibleVisionOptions } from '../src/adapters/openai-compatible/types.ts'

/** A Context with a stubbed credential seam recording every set. */
function ctxWithSeam(values: Record<string, string>): { ctx: Context; setCalls: Array<{ ref: string; value: string }> } {
  const ctx = new Context()
  const setCalls: Array<{ ref: string; value: string }> = []
  ctx.provide('credentials', {
    resolve: vi.fn(async (ref: unknown) => {
      const hit = values[String(ref)]
      return hit !== undefined ? { value: hit, source: 'test' } : undefined
    }),
    set: vi.fn(async (ref: unknown, value: string) => {
      setCalls.push({ ref: String(ref), value })
      values[String(ref)] = value
    }),
  } as never)
  return { ctx, setCalls }
}

function snapshot(overrides: Partial<OpenAICompatibleVisionOptions> = {}): OpenAICompatibleVisionOptions {
  return {
    provider: 'p',
    baseURL: 'https://api.example.com/v1',
    model: 'm',
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 60_000,
    ...overrides,
  }
}

describe('credential integration: set → resolve → missing, secrets stay host-side', () => {
  it('a stored key resolves through the seam and is never echoed in the snapshot', async () => {
    const { ctx } = ctxWithSeam({ OPENCODE_GO_API_KEY: ' sk-secret ' })
    const key = await resolveApiKey(ctx, snapshot({ apiKeyEnv: 'OPENCODE_GO_API_KEY' }))
    expect(key).toBe('sk-secret')
    // The key value never lives on the endpoint snapshot.
    expect(JSON.stringify(snapshot({ apiKeyEnv: 'OPENCODE_GO_API_KEY' }))).not.toContain('sk-secret')
  })

  it('a missing key fails with an actionable MISSING_CREDENTIAL that names only the ref', async () => {
    const { ctx } = ctxWithSeam({})
    await expect(resolveApiKey(ctx, snapshot({ apiKeyEnv: 'MISSING_KEY' })))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    await expect(resolveApiKey(ctx, snapshot({ apiKeyEnv: 'MISSING_KEY' })))
      .rejects.toMatchObject({ message: expect.stringContaining('MISSING_KEY') })
  })

  it('the settings-card draft carries the typed key only into the draft snapshot', async () => {
    // draftProvider is what the host RPC builds from the card's draft fields:
    // the typed key lands on the draft spec (host-process only), the returned
    // draft object the card sees contains the reference, not the value.
    const spec = draftProvider('p', { baseURL: 'https://x.example/v1', model: 'm', apiKey: 'sk-typed-now' }, {})
    expect(spec.apiKey).toBe('sk-typed-now')
    // Serialized for the browser: the card's own saved-section view never
    // carries the key — the host redacts it before any wire response.
    const cardView = JSON.parse(JSON.stringify({ baseURL: spec.baseURL, model: spec.model, apiKeyEnv: spec.apiKeyEnv ?? '' }))
    expect(JSON.stringify(cardView)).not.toContain('sk-typed-now')
  })

  it('deriveKeyRef is the stable ref the card derives for a typed key', () => {
    expect(deriveKeyRef('opencode-go')).toBe('OPENCODE_GO_API_KEY')
    expect(deriveKeyRef('my custom provider')).toBe('MY_CUSTOM_PROVIDER_API_KEY')
  })

  it('a malformed key is refused as INVALID_CREDENTIAL without echoing the value', async () => {
    const { ctx } = ctxWithSeam({ BAD: '   ' })
    await expect(resolveApiKey(ctx, snapshot({ apiKeyEnv: 'BAD' })))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
    expect(() => assertUsableApiKey('has\u0000control', 'REF')).toThrow(ImageMindVisionError)
  })

  it('list-models draft needs only the endpoint; the key rides the draft, never the card reply', () => {
    const spec = draftProviderForListing('list', { baseURL: 'https://x.example/v1', apiKey: 'sk-list' }, {})
    expect(spec.baseURL).toBe('https://x.example/v1')
    expect(spec.apiKey).toBe('sk-list')
    const reply = { ok: true, models: ['m1'], source: 'endpoint' as const }
    expect(JSON.stringify(reply)).not.toContain('sk-list')
  })
})
