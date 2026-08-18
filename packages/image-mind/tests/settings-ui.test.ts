/**
 * Settings UI logic tests: provider route id rules, keyless facts, and the
 * connection fingerprint that invalidates stale test results.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  isValidProviderId, connectionFingerprint, isKeylessBaseURL, deriveKeyRef,
} from '../src/client/settings/identity.ts'

describe('provider route id rules', () => {
  it('accepts valid custom ids', () => {
    for (const id of ['my-provider', 'vision.local', 'provider_1', 'a', 'a1.b-c_d']) {
      expect(isValidProviderId(id), id).toBe(true)
    }
  })

  it('rejects invalid custom ids with a clear rule', () => {
    for (const id of ['123abc', 'Provider', 'my provider', '中文', '-lead', 'trail-', 'a b', '']) {
      expect(isValidProviderId(id), id).toBe(false)
    }
  })

  it('catalog ids pass the route rules (stability)', () => {
    expect(isValidProviderId('opencode-go')).toBe(true)
    expect(isValidProviderId('commandcode-goat')).toBe(true)
    // A display name must NEVER become a route id via normalization.
    expect('Opencode Go'.trim().replace(/\s+/g, '-')).not.toBe('opencode-go')
  })
})

describe('keyless provider facts', () => {
  it('local endpoint roots are keyless by default', () => {
    expect(isKeylessBaseURL('http://localhost:11434/v1')).toBe(true)
    expect(isKeylessBaseURL('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isKeylessBaseURL('http://[::1]:8080/v1')).toBe(true)
  })

  it('remote endpoints are never auto-keyless', () => {
    expect(isKeylessBaseURL('https://api.example.com/v1')).toBe(false)
    expect(isKeylessBaseURL('https://opencode.ai/zen/go/v1')).toBe(false)
  })
})

describe('connection fingerprint (test-result invalidation)', () => {
  const base = {
    baseURL: 'https://a.example/v1',
    model: 'm',
    apiStyle: 'chat-completions',
    maxOutputTokens: '1024',
    apiKeyEnv: 'KEY_A',
    apiKeyConfigured: true,
    keyless: false,
    apiKeyText: '*',
  }

  it('identical configs share a fingerprint', () => {
    expect(connectionFingerprint(base)).toBe(connectionFingerprint({ ...base }))
  })

  it('changing any wire field changes the fingerprint', () => {
    const fields: Array<Partial<typeof base>> = [
      { baseURL: 'https://b.example/v1' },
      { model: 'm2' },
      { apiStyle: 'responses' },
      { maxOutputTokens: '2048' },
      { apiKeyEnv: 'KEY_B' },
      { keyless: true },
    ]
    for (const change of fields) {
      expect(connectionFingerprint({ ...base, ...change }), JSON.stringify(change)).not.toBe(connectionFingerprint(base))
    }
  })

  it('a typed key changes the fingerprint; a mask does not', () => {
    expect(connectionFingerprint({ ...base, apiKeyText: 'sk-typed' })).not.toBe(connectionFingerprint(base))
    expect(connectionFingerprint({ ...base, apiKeyText: '***' })).toBe(connectionFingerprint({ ...base, apiKeyText: '*' }))
  })
})

describe('deriveKeyRef (host-owned single definition)', () => {
  it('derives the conventional credential reference', () => {
    expect(deriveKeyRef('opencode-go')).toBe('OPENCODE_GO_API_KEY')
    expect(deriveKeyRef('my custom provider')).toBe('MY_CUSTOM_PROVIDER_API_KEY')
  })
})
