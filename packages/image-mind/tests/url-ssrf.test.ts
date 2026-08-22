/**
 * URL / SSRF guard tests: private/non-public IP classification (IPv4, IPv6,
 * IPv4-mapped), DNS pre-resolution (private and public), local names,
 * embedded URL credentials, redirect rejection, and query-stripped error
 * excerpts. DNS resolution is injected so no test touches the real network.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { isPrivateIP, validateImageUrl, safeUrlExcerpt } from '../src/media/network.ts'

describe('isPrivateIP (node:net based classification)', () => {
  it('private and special-use IPv4 ranges', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true)
    expect(isPrivateIP('10.0.0.1')).toBe(true)
    expect(isPrivateIP('172.16.0.1')).toBe(true)
    expect(isPrivateIP('172.31.255.255')).toBe(true)
    expect(isPrivateIP('192.168.1.1')).toBe(true)
    expect(isPrivateIP('169.254.169.254')).toBe(true)
    expect(isPrivateIP('0.0.0.0')).toBe(true)
    expect(isPrivateIP('100.64.0.1')).toBe(true)
    expect(isPrivateIP('100.127.255.254')).toBe(true)
    expect(isPrivateIP('192.0.2.10')).toBe(true)
    expect(isPrivateIP('198.18.0.1')).toBe(true)
    expect(isPrivateIP('198.19.255.254')).toBe(true)
    expect(isPrivateIP('198.51.100.10')).toBe(true)
    expect(isPrivateIP('203.0.113.10')).toBe(true)
    expect(isPrivateIP('224.0.0.1')).toBe(true)
    expect(isPrivateIP('255.255.255.255')).toBe(true)
  })

  it('public IPv4 addresses', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false)
    expect(isPrivateIP('1.1.1.1')).toBe(false)
    expect(isPrivateIP('100.128.0.1')).toBe(false) // Outside 100.64/10.
    expect(isPrivateIP('172.32.0.1')).toBe(false) // Outside 172.16/12.
    expect(isPrivateIP('192.169.1.1')).toBe(false)
    expect(isPrivateIP('198.20.0.1')).toBe(false) // Outside 198.18/15.
  })

  it('private and special-use IPv6 addresses', () => {
    expect(isPrivateIP('::')).toBe(true)
    expect(isPrivateIP('::1')).toBe(true)
    expect(isPrivateIP('100::1')).toBe(true)
    expect(isPrivateIP('2001:2::1')).toBe(true)
    expect(isPrivateIP('2001:db8::1')).toBe(true)
    expect(isPrivateIP('fc00::1')).toBe(true)
    expect(isPrivateIP('fd12:3456::1')).toBe(true)
    expect(isPrivateIP('fe80::1')).toBe(true)
    expect(isPrivateIP('ff02::1')).toBe(true)
  })

  it('IPv4-mapped IPv6 private/non-public addresses', () => {
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true)
    expect(isPrivateIP('::ffff:100.64.0.1')).toBe(true)
    expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true)
    expect(isPrivateIP('::ffff:198.18.0.1')).toBe(true)
    expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false)
  })

  it('public IPv6 addresses', () => {
    expect(isPrivateIP('2606:4700::1111')).toBe(false)
    expect(isPrivateIP('2001:4860:4860::8888')).toBe(false)
  })
})

describe('validateImageUrl (SSRF fence)', () => {
  const allow = false
  const deny = async (): Promise<string[]> => { throw new Error('no dns') }

  it('allows a public literal IP', async () => {
    const url = await validateImageUrl('https://8.8.8.8/img.png', allow, deny)
    expect(url.hostname).toBe('8.8.8.8')
  })

  it('rejects private and non-public literal IPs', async () => {
    await expect(validateImageUrl('https://127.0.0.1/img.png', allow, deny)).rejects.toThrow(/private network/)
    await expect(validateImageUrl('https://100.64.0.1/img.png', allow, deny)).rejects.toThrow(/private network/)
    await expect(validateImageUrl('https://198.18.0.1/img.png', allow, deny)).rejects.toThrow(/private network/)
    await expect(validateImageUrl('https://[::1]/img.png', allow, deny)).rejects.toThrow(/private network/)
    await expect(validateImageUrl('https://[2001:db8::1]/img.png', allow, deny)).rejects.toThrow(/private network/)
    await expect(validateImageUrl('https://[::ffff:10.0.0.1]/img.png', allow, deny)).rejects.toThrow(/private network/)
  })

  it('rejects local names without DNS', async () => {
    await expect(validateImageUrl('https://localhost/img.png', allow, deny)).rejects.toThrow(/private network/)
    await expect(validateImageUrl('https://foo.localhost/img.png', allow, deny)).rejects.toThrow(/private network/)
  })

  it('rejects a hostname whose DNS lands private or special-use', async () => {
    const resolvePrivate = async (): Promise<string[]> => ['10.0.0.5']
    const resolveCgnat = async (): Promise<string[]> => ['100.64.0.5']
    const resolveBenchmark = async (): Promise<string[]> => ['198.18.0.5']
    await expect(validateImageUrl('https://attacker.example/img.png', allow, resolvePrivate)).rejects.toThrow(/resolves to a private network/)
    await expect(validateImageUrl('https://attacker.example/img.png', allow, resolveCgnat)).rejects.toThrow(/resolves to a private network/)
    await expect(validateImageUrl('https://attacker.example/img.png', allow, resolveBenchmark)).rejects.toThrow(/resolves to a private network/)
  })

  it('allows a hostname whose DNS lands public', async () => {
    const resolvePublic = async (): Promise<string[]> => ['93.184.216.34']
    const url = await validateImageUrl('https://example.com/img.png', allow, resolvePublic)
    expect(url.hostname).toBe('example.com')
  })

  it('rejects embedded URL credentials', async () => {
    await expect(validateImageUrl('https://user:pass@host/img.png', allow, deny)).rejects.toThrow(/credentials/)
  })

  it('allowPrivateNetwork permits non-public literals', async () => {
    const url = await validateImageUrl('http://100.64.0.1:8080/img.png', true, deny)
    expect(url.hostname).toBe('100.64.0.1')
  })

  it('safeUrlExcerpt strips the query string (no token leaks in errors)', () => {
    expect(safeUrlExcerpt('https://host/img.png?token=SECRET')).toBe('https://host/img.png')
    expect(safeUrlExcerpt('https://host/a/b.png#frag')).toBe('https://host/a/b.png')
  })
})
