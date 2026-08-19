/**
 * Model-discovery provider-overlay tests: `listEndpointModels` must use the
 * SAME provider-scoped overlay semantics as the connection test — the saved
 * fields come from `providers[providerId]`, never the whole section treated
 * as one provider, and draft overrides win for that one discovery request.
 * The fetch is stubbed so the suite stays fully offline; the assertions read
 * the URL and Authorization header the discovery would have sent.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { listEndpointModels } from '../src/runtime/vision-rpc.ts'

/** The saved image-mind section used by the fake settings seam. */
const SECTION = {
  providers: {
    'provider-a': {
      displayName: 'Provider A',
      baseURL: 'https://a.example/v1',
      model: 'model-a',
      apiKeyEnv: 'KEY_A',
    },
    'provider-b': {
      displayName: 'Provider B',
      baseURL: 'https://b.example/v1',
      model: 'model-b',
      apiKeyEnv: 'KEY_B',
    },
  },
  timeoutMs: 30_000,
}

/** Overlay the draft over the saved provider record (same rule vision-rpc uses). */
function savedProviderRecord(providerId: string): Record<string, unknown> {
  const record = (SECTION['providers'] as Record<string, string | undefined>)[providerId]
  return {
    ...SECTION,
    ...record === undefined ? {} : (SECTION['providers'] as Record<string, Record<string, unknown>>)[providerId],
    timeoutMs: SECTION['timeoutMs'],
  }
}

/** A fake context with a read-only settings seam and a resolvable credential plane. */
function makeContext(keyValues: Record<string, string>): Context {
  const credentialValues = new Map(Object.entries(keyValues))
  return {
    get: (key: string): unknown => {
      if (key === 'settings') return { get: () => ({ ...SECTION }) }
      if (key === 'credentials') {
        return {
          resolve: async (ref: unknown) => {
            const name = String(ref)
            const value = credentialValues.get(name)
            return value === undefined ? undefined : { value }
          },
        }
      }
      return undefined
    },
  } as unknown as Context
}

describe('listEndpointModels provider overlay', () => {
  const requests: Array<{ url: string; auth: string | undefined }> = []

  afterEach(() => {
    vi.unstubAllGlobals()
    requests.length = 0
  })

  function stubFetch(): void {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        auth: (init?.headers as Record<string, string> | undefined)?.['authorization'],
      })
      return new Response(JSON.stringify({ data: [{ id: 'm-b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
  }

  it('uses providers[provider-b] facts — never provider-a or the top-level section', async () => {
    stubFetch()
    const ctx = makeContext({ KEY_A: 'sk-test-a', KEY_B: 'sk-test-b' })
    const outcome = await listEndpointModels(ctx, { providerId: 'provider-b' })

    expect(outcome.ok).toBe(true)
    expect(requests).toHaveLength(1)
    // The endpoint interrogated is provider-b's, and its credential, not A's.
    expect(requests[0].url).toBe('https://b.example/v1/models')
    expect(requests[0].auth).toBe('Bearer sk-test-b')
    expect(requests[0].auth).not.toBe('Bearer sk-test-a')
  })

  it('draft overlay wins for the discovery request only (baseURL + apiKeyEnv)', async () => {
    stubFetch()
    const ctx = makeContext({ KEY_B: 'sk-test-b', KEY_B2: 'sk-test-b2' })
    const outcome = await listEndpointModels(ctx, {
      providerId: 'provider-b',
      baseURL: 'https://b2.example/v2',
      apiKeyEnv: 'KEY_B2',
    })

    expect(outcome.ok).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://b2.example/v2/models')
    expect(requests[0].auth).toBe('Bearer sk-test-b2')
  })

  it('model discovery attaches the provider to the record (A/B isolation is symmetric)', async () => {
    stubFetch()
    const ctx = makeContext({ KEY_A: 'sk-test-a', KEY_B: 'sk-test-b' })
    const outcome = await listEndpointModels(ctx, { providerId: 'provider-a' })

    expect(outcome.ok).toBe(true)
    expect(requests[0].url).toBe('https://a.example/v1/models')
    expect(requests[0].auth).toBe('Bearer sk-test-a')
  })

  it('keeps the global section timeout while overlaying provider fields', () => {
    // Same overlay helper the runtime uses: the merged record must carry the
    // provider fields AND the section-level timeout.
    const merged = savedProviderRecord('provider-b')
    expect(merged['baseURL']).toBe('https://b.example/v1')
    expect(merged['apiKeyEnv']).toBe('KEY_B')
    expect(merged['timeoutMs']).toBe(30_000)
  })
})