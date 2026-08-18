/**
 * Legacy inline apiKey migration tests: collection, credential-store write,
 * settings-document clear, failure retention (never loses the config), and
 * reference derivation.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { collectLegacyInlineKeys, deriveKeyRef, migrateLegacyInlineKeys } from '../src/credentials/migrate.ts'
import type { Provider } from '../src/config.ts'

describe('deriveKeyRef', () => {
  it('derives a safe reference from a provider id', () => {
    expect(deriveKeyRef('my-vision')).toBe('MY_VISION_API_KEY')
    expect(deriveKeyRef('opencode-go')).toBe('OPENCODE_GO_API_KEY')
    expect(deriveKeyRef('commandcode.goat')).toBe('COMMANDCODE_GOAT_API_KEY')
  })
})

describe('collectLegacyInlineKeys', () => {
  it('collects providers with an inline apiKey', () => {
    const providers: Record<string, Provider> = {
      'a': { baseURL: 'https://a/v1', model: 'm', apiKey: 'sk-aaa' },
      'b': { baseURL: 'https://b/v1', model: 'm' },
    }
    const keys = collectLegacyInlineKeys(providers)
    expect(keys).toHaveLength(1)
    expect(keys[0].provider).toBe('a')
    expect(keys[0].ref).toBe('A_API_KEY')
    expect(keys[0].value).toBe('sk-aaa')
  })

  it('prefers the provider apiKeyEnv as the target reference', () => {
    const providers: Record<string, Provider> = {
      'a': { baseURL: 'https://a/v1', model: 'm', apiKey: 'sk-aaa', apiKeyEnv: 'CUSTOM_REF' },
    }
    const keys = collectLegacyInlineKeys(providers)
    expect(keys[0].ref).toBe('CUSTOM_REF')
  })

  it('returns empty for no inline keys', () => {
    expect(collectLegacyInlineKeys({ 'a': { baseURL: 'https://a/v1', model: 'm' } })).toHaveLength(0)
    expect(collectLegacyInlineKeys(undefined)).toHaveLength(0)
  })
})

describe('migrateLegacyInlineKeys', () => {
  function ctxWithSeams(): { ctx: Context; stored: Map<string, string>; settingsMutated: Array<{ op: string; path: string[] }> } {
    const ctx = new Context()
    const stored = new Map<string, string>()
    const settingsMutated: Array<{ op: string; path: string[] }> = []
    ctx.provide('credentials', {
      set: vi.fn(async (ref: ReturnType<typeof credentialRef>, value: string) => {
        stored.set(String(ref), value)
      }),
      resolve: vi.fn(async (ref: ReturnType<typeof credentialRef>) =>
        stored.has(String(ref)) ? { value: stored.get(String(ref))!, source: 'test' } : undefined),
    } as never)
    ctx.provide('settings', {
      mutate: vi.fn(async (_ns: unknown, ops: Array<{ op: string; path: string[] }>) => {
        for (const op of ops) settingsMutated.push(op)
      }),
    } as never)
    return { ctx, stored, settingsMutated }
  }

  it('migrates inline keys into the credential store and clears the document', async () => {
    const { ctx, stored, settingsMutated } = ctxWithSeams()
    const providers: Record<string, Provider> = {
      'a': { baseURL: 'https://a/v1', model: 'm', apiKey: 'sk-aaa' },
    }
    const migrated = await migrateLegacyInlineKeys(ctx, providers)
    expect(migrated).toBe(1)
    expect(stored.get('A_API_KEY')).toBe('sk-aaa')
    expect(settingsMutated).toEqual([{ op: 'unset', path: ['providers', 'a', 'apiKey'] }])
  })

  it('keeps the inline field when the store write fails (never loses config)', async () => {
    const ctx = new Context()
    const settingsMutated: Array<{ op: string; path: string[] }> = []
    ctx.provide('credentials', {
      set: vi.fn(async () => { throw new Error('read-only shadowing layer') }),
    } as never)
    ctx.provide('settings', {
      mutate: vi.fn(async (_ns: unknown, ops: Array<{ op: string; path: string[] }>) => {
        for (const op of ops) settingsMutated.push(op)
      }),
    } as never)
    const providers: Record<string, Provider> = {
      'a': { baseURL: 'https://a/v1', model: 'm', apiKey: 'sk-aaa' },
    }
    const migrated = await migrateLegacyInlineKeys(ctx, providers)
    expect(migrated).toBe(0)
    // No clear op: the inline key stays so resolution still works host-only.
    expect(settingsMutated).toHaveLength(0)
  })

  it('keeps the inline keys when no credential seam is mounted', async () => {
    const ctx = new Context()
    const providers: Record<string, Provider> = {
      'a': { baseURL: 'https://a/v1', model: 'm', apiKey: 'sk-aaa' },
    }
    const migrated = await migrateLegacyInlineKeys(ctx, providers)
    expect(migrated).toBe(0)
  })

  it('is a no-op when no legacy keys exist', async () => {
    const { ctx } = ctxWithSeams()
    const migrated = await migrateLegacyInlineKeys(ctx, { 'a': { baseURL: 'https://a/v1', model: 'm' } })
    expect(migrated).toBe(0)
  })
})
