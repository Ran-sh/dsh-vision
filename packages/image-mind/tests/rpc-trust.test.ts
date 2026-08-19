/**
 * Trust-fence tests for the secret-bearing RPC routes: loopback socket +
 * loopback Host + same-origin browser markers gate /test, /models, and the
 * legacy config POST; a cross-origin or remote request is refused with 403.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { isTrustedLocalRequest } from '../src/attachments/routes.ts'

/** Build a minimal IncomingMessage-like request with the given facts. */
function request(opts: {
  remoteAddress?: string
  host?: string
  origin?: string
}): IncomingMessage {
  const headers: Record<string, string | undefined> = {}
  if (opts.host !== undefined) headers['host'] = opts.host
  if (opts.origin !== undefined) headers['origin'] = opts.origin
  return {
    headers,
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
  } as unknown as IncomingMessage
}

describe('secret-bearing RPC trust fence', () => {
  it('loopback socket + loopback host + no origin → allowed', () => {
    expect(isTrustedLocalRequest(request({ remoteAddress: '127.0.0.1', host: 'localhost:3000' }))).toBe(true)
    expect(isTrustedLocalRequest(request({ remoteAddress: '::1', host: '[::1]:3000' }))).toBe(true)
    expect(isTrustedLocalRequest(request({ remoteAddress: '::ffff:127.0.0.1', host: '127.0.0.1' }))).toBe(true)
  })

  it('same-origin browser marker → allowed (hostname AND effective port match)', () => {
    expect(isTrustedLocalRequest(request({ host: 'localhost:3000', origin: 'http://localhost:3000' }))).toBe(true)
    expect(isTrustedLocalRequest(request({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }))).toBe(true)
    expect(isTrustedLocalRequest(request({ remoteAddress: '::1', host: '[::1]:3000', origin: 'http://[::1]:3000' }))).toBe(true)
  })

  it('default-port authorities match without an explicit port', () => {
    expect(isTrustedLocalRequest(request({ host: 'localhost', origin: 'http://localhost' }))).toBe(true)
    expect(isTrustedLocalRequest(request({ host: '127.0.0.1', origin: 'http://127.0.0.1' }))).toBe(true)
  })

  it('different localhost port → rejected (localhost:3000 page cannot reach localhost:3000 secret RPC via another port)', () => {
    expect(isTrustedLocalRequest(request({ host: 'localhost:3000', origin: 'http://localhost:9999' }))).toBe(false)
    expect(isTrustedLocalRequest(request({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:9999' }))).toBe(false)
  })

  it('same port but different hostname → rejected (distinct browser origins)', () => {
    // 127.0.0.1 and localhost are both loopback, but they are DIFFERENT origins.
    expect(isTrustedLocalRequest(request({ host: '127.0.0.1:3000', origin: 'http://localhost:3000' }))).toBe(false)
    expect(isTrustedLocalRequest(request({ host: 'localhost:3000', origin: 'http://127.0.0.1:3000' }))).toBe(false)
  })

  it('IPv6 authority must match exactly (bracketed, never split on ":")', () => {
    expect(isTrustedLocalRequest(request({ remoteAddress: '::1', host: '[::1]:3000', origin: 'http://[::1]:9999' }))).toBe(false)
  })

  it('cross-origin browser marker → rejected (malicious page cannot POST a draft key)', () => {
    expect(isTrustedLocalRequest(request({ host: 'localhost:3000', origin: 'https://evil.example' }))).toBe(false)
    expect(isTrustedLocalRequest(request({ host: '127.0.0.1', origin: 'http://192.168.1.5' }))).toBe(false)
    // A scheme-implied default port (https 443) never matches the local HTTP
    // authority (80) — the request object carries no trustworthy scheme, so
    // default ports keep URL semantics.
    expect(isTrustedLocalRequest(request({ host: 'localhost', origin: 'https://localhost' }))).toBe(false)
  })

  it('remote socket → rejected (matches the official settings seam remote restriction)', () => {
    expect(isTrustedLocalRequest(request({ remoteAddress: '192.168.1.5', host: '192.168.1.5:3000' }))).toBe(false)
    expect(isTrustedLocalRequest(request({ remoteAddress: '10.0.0.3', host: 'localhost:3000' }))).toBe(false)
    // Even a perfect loopback Host + origin pair cannot help a remote socket.
    expect(isTrustedLocalRequest(request({ remoteAddress: '192.168.1.5', host: 'localhost:3000', origin: 'http://localhost:3000' }))).toBe(false)
  })

  it('a rebound DNS host name → rejected (Host is not loopback)', () => {
    expect(isTrustedLocalRequest(request({ remoteAddress: '127.0.0.1', host: 'attacker.example' }))).toBe(false)
  })
})
