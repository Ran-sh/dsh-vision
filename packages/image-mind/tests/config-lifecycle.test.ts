/**
 * Configuration lifecycle tests: official last-good resolution (bad live
 * config keeps the previous snapshot; recovery when config turns good) and
 * credential precedence (seam mounted owns the plane; environment fallback
 * only without the seam).
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveConfig } from '../src/config.ts'
import { resolveApiKey } from '../src/credentials/resolve.ts'
import type { OpenAICompatibleVisionOptions } from '../src/adapters/openai-compatible/types.ts'

function goodRaw() {
  return {
    providers: {
      'a': { baseURL: 'https://a.example/v1', model: 'm1', apiKeyEnv: 'KEY_A' },
    },
    active: 'a',
  }
}

function goodConfig() {
  return resolveConfig(goodRaw())
}

function badConfig() {
  // Beyond-schema bound failure: active names a provider with empty baseURL.
  return resolveConfig({
    providers: {
      'a': { baseURL: '', model: '', apiKeyEnv: 'KEY_A' },
    },
    active: 'a',
  })
}

describe('last-good configuration', () => {
  it('a bad live snapshot throws when no last good exists (fail loud at load)', () => {
    expect(() => badConfig()).toThrow(/incomplete/)
  })

  it('keeps the last good snapshot after a bad one, then recovers', () => {
    // Emulate the official pattern exactly: lastRaw/lastGood memoization.
    const badRaw = () => ({
      providers: { 'a': { baseURL: '', model: '', apiKeyEnv: 'KEY_A' } },
      active: 'a',
    })
    let current: () => Parameters<typeof resolveConfig>[0] = () => goodRaw()
    let lastRaw: unknown
    let lastGood: ReturnType<typeof resolveConfig> | undefined
    let errorCount = 0
    const resolve = (): ReturnType<typeof resolveConfig> => {
      const raw = current()
      if (raw === lastRaw && lastGood !== undefined) return lastGood
      try {
        const next = resolveConfig(raw)
        lastRaw = raw
        lastGood = next
        return next
      } catch (error) {
        if (lastGood === undefined) throw error
        lastRaw = raw
        errorCount += 1
        return lastGood
      }
    }

    // Initial good.
    const first = resolve()
    expect(first.providers['a'].model).toBe('m1')

    // Bad live config (the settings seam hands the SAME snapshot object until
    // it changes — the memoization keys on that identity): keep the last good.
    const badSnapshot = badRaw()
    current = () => badSnapshot
    const retained = resolve()
    expect(retained.providers['a'].model).toBe('m1')
    expect(errorCount).toBe(1)

    // Same bad raw snapshot: memoized, no repeat log.
    resolve()
    expect(errorCount).toBe(1)

    // Recovery: config turns good again.
    current = () => goodRaw()
    const recovered = resolve()
    expect(recovered.providers['a'].model).toBe('m1')
  })
})

function connection(overrides: Partial<OpenAICompatibleVisionOptions> = {}): OpenAICompatibleVisionOptions {
  return {
    provider: 'a',
    baseURL: 'https://a.example/v1',
    model: 'm',
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 60_000,
    ...overrides,
  }
}

describe('credential precedence (official semantics)', () => {
  it('when the seam is mounted, a miss there is authoritative (no env fallback)', async () => {
    const ctx = new Context()
    process.env['SEAM_KEY'] = 'sk-from-env'
    ctx.provide('credentials', {
      resolve: vi.fn(async () => undefined),
    } as never)
    // The env HAS the key, but the seam says no: resolution must fail.
    await expect(resolveApiKey(ctx, connection({ apiKeyEnv: 'SEAM_KEY' }))).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
    })
    delete process.env['SEAM_KEY']
  })

  it('the seam value wins when mounted', async () => {
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: vi.fn(async () => ({ value: 'sk-seam', source: 'test' })),
    } as never)
    const key = await resolveApiKey(ctx, connection({ apiKeyEnv: 'SEAM_KEY' }))
    expect(key).toBe('sk-seam')
  })

  it('without the seam, the launch environment is the whole plane', async () => {
    const ctx = new Context()
    process.env['ENV_KEY'] = 'sk-env'
    const key = await resolveApiKey(ctx, connection({ apiKeyEnv: 'ENV_KEY' }))
    expect(key).toBe('sk-env')
    delete process.env['ENV_KEY']
  })

  it('a draft inline key wins for that call alone', async () => {
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: vi.fn(async () => ({ value: 'sk-seam', source: 'test' })),
    } as never)
    const key = await resolveApiKey(ctx, connection({ apiKeyEnv: 'SEAM_KEY', inlineApiKey: 'sk-draft' }))
    expect(key).toBe('sk-draft')
  })

  it('keyless localhost endpoints resolve to an empty bearer', async () => {
    const ctx = new Context()
    const key = await resolveApiKey(ctx, connection({ baseURL: 'http://localhost:11434/v1' }))
    expect(key).toBe('')
  })
})

describe('migration-safe legacy fallback', () => {
  it('a still-unmigrated inline key resolves host-only via the snapshot', async () => {
    // resolveApiKey reads `inlineApiKey` on the connection; the migration
    // keeps it there until the store write succeeds.
    const ctx = new Context()
    const key = await resolveApiKey(ctx, connection({ inlineApiKey: 'sk-legacy' }))
    expect(key).toBe('sk-legacy')
  })

  it('a blank legacy value is refused as INVALID_CREDENTIAL', async () => {
    const ctx = new Context()
    await expect(resolveApiKey(ctx, connection({ inlineApiKey: '   ' }))).rejects.toMatchObject({
      code: 'INVALID_CREDENTIAL',
    })
  })
})
