/**
 * Credential resolution tests: credential store, environment fallback, missing
 * credential, invalid key, and credential collision.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveApiKey, assertUsableApiKey } from '../src/credentials/resolve.ts'
import { VisionError } from '../src/runtime/errors.ts'
import type { VisionConnection } from '../src/runtime/types.ts'

function connection(overrides: Partial<VisionConnection> = {}): VisionConnection {
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

/** A Context with a stubbed credential seam. */
function ctxWithCredentials(values: Record<string, string>): Context {
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: vi.fn(async (ref: ReturnType<typeof credentialRef>) =>
      values[String(ref)] !== undefined ? { value: values[String(ref)], source: 'test' } : undefined),
  } as never)
  return ctx
}

describe('resolveApiKey', () => {
  it('resolves through the credential seam', async () => {
    const ctx = ctxWithCredentials({ KEY: ' sk-abc ' })
    const key = await resolveApiKey(ctx, connection({ apiKeyEnv: 'KEY' }))
    expect(key).toBe('sk-abc')
  })

  it('throws a typed MISSING_CREDENTIAL when the seam has nothing', async () => {
    const ctx = ctxWithCredentials({})
    await expect(resolveApiKey(ctx, connection({ apiKeyEnv: 'MISSING' }))).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
    })
  })

  it('throws a typed INVALID_CREDENTIAL for a whitespace-only value', async () => {
    const ctx = ctxWithCredentials({ KEY: '   ' })
    await expect(resolveApiKey(ctx, connection({ apiKeyEnv: 'KEY' }))).rejects.toMatchObject({
      code: 'INVALID_CREDENTIAL',
    })
  })

  it('resolves keyless localhost endpoints to an empty bearer', async () => {
    const ctx = new Context()
    const key = await resolveApiKey(ctx, connection({ baseURL: 'http://localhost:11434/v1' }))
    expect(key).toBe('')
  })

  it('still requires a key for a non-localhost endpoint with no seam', async () => {
    const ctx = new Context()
    await expect(resolveApiKey(ctx, connection({ apiKeyEnv: 'KEY' }))).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
    })
  })
})

describe('assertUsableApiKey', () => {
  it('trims surrounding whitespace', () => {
    expect(assertUsableApiKey('  sk-abc  ', 'REF')).toBe('sk-abc')
  })

  it('rejects an empty value', () => {
    expect(() => assertUsableApiKey('', 'REF')).toThrow(VisionError)
  })

  it('rejects control characters', () => {
    expect(() => assertUsableApiKey('sk-a\u0000b', 'REF')).toThrow(VisionError)
  })
})

describe('credential collision detection', () => {
  it('two providers sharing one ref resolve the same value (no silent divergence)', async () => {
    const ctx = ctxWithCredentials({ SHARED: 'sk-shared' })
    const a = await resolveApiKey(ctx, connection({ provider: 'a', apiKeyEnv: 'SHARED' }))
    const b = await resolveApiKey(ctx, connection({ provider: 'b', apiKeyEnv: 'SHARED' }))
    expect(a).toBe('sk-shared')
    expect(b).toBe('sk-shared')
  })
})
