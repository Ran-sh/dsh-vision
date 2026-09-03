/**
 * Endpoint policy: credentials must never ride a non-loopback http://
 * endpoint; embedded credentials and query/hash on a provider URL are
 * refused; only http(s) is a valid transport.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, validateProviderEndpoint } from '../src/providers/endpoint-policy.ts'

describe('validateProviderEndpoint', () => {
  it('accepts an https remote endpoint with a credential', () => {
    const url = validateProviderEndpoint('https://api.openai.com/v1', true)
    expect(url.hostname).toBe('api.openai.com')
  })

  it('accepts http localhost with a credential (local Ollama-style)', () => {
    const url = validateProviderEndpoint('http://localhost:11434/v1', true)
    expect(url.hostname).toBe('localhost')
  })

  it('accepts http 127/8 loopback with a credential', () => {
    expect(validateProviderEndpoint('http://127.0.0.1:8080/v1', true).hostname).toBe('127.0.0.1')
    expect(validateProviderEndpoint('http://127.8.9.10:8080/v1', true).hostname).toBe('127.8.9.10')
  })

  it('rejects a remote http endpoint when a credential would be sent', () => {
    expect(() => validateProviderEndpoint('http://remote-host.example:8080/v1', true)).toThrow(/HTTPS/)
  })

  it('accepts a remote http endpoint only when no credential is required', () => {
    expect(() => validateProviderEndpoint('http://remote-host.example:8080/v1', false)).not.toThrow()
  })

  it('rejects embedded username/password', () => {
    expect(() => validateProviderEndpoint('https://user:pass@api.openai.com/v1', true)).toThrow(/username|password/)
  })

  it('rejects a query string or hash on the endpoint', () => {
    expect(() => validateProviderEndpoint('https://api.openai.com/v1?key=abc', true)).toThrow(/query|hash/)
    expect(() => validateProviderEndpoint('https://api.openai.com/v1#frag', true)).toThrow(/query|hash/)
  })

  it('rejects non-http(s) protocols', () => {
    expect(() => validateProviderEndpoint('ftp://api.openai.com/v1', true)).toThrow(/http or https/)
    expect(() => validateProviderEndpoint('file:///etc/passwd', true)).toThrow(/http or https/)
  })

  it('isLoopbackHostname covers localhost, 127/8 and loopback IPv6', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.255.1.2')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('10.0.0.5')).toBe(false)
    expect(isLoopbackHostname('192.168.1.1')).toBe(false)
  })
})
