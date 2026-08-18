/**
 * Private-network classification for image URL fetching (SSRF guard).
 * Uses node:net for proper IPv4/IPv6/IPv4-mapped parsing — no regex range
 * guessing — plus DNS pre-resolution when the host is a name.
 *
 * Honest scope (documented in README): this blocks explicit private
 * literals, pre-resolves DNS and rejects any A/AAAA that lands private, and
 * rejects redirects. It cannot pin the socket to the validated address
 * against a DNS-rebinding race; that would require a network sandbox the
 * plugin layer does not provide.
 * @module dsh-plugin-image-mind/media/network
 */

import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/** Private IPv4 ranges (RFC 1918 + loopback + link-local + this-host). */
function isPrivateIPv4(octets: readonly number[]): boolean {
  const [a, b] = octets
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  return false
}

/** Private IPv6 ranges: loopback, ULA, link-local, IPv4-mapped private. */
function isPrivateIPv6(parts: readonly number[]): boolean {
  const head = parts[0]
  const second = parts[1]
  // ::1 loopback.
  if (head === 0 && second === 0 && parts[2] === 0 && parts[3] === 0 && parts[4] === 0 && parts[5] === 0 && parts[6] === 0 && parts[7] === 1) return true
  // ::ffff:a.b.c.d IPv4-mapped.
  if (head === 0 && second === 0 && parts[2] === 0 && parts[3] === 0 && parts[4] === 0 && parts[5] === 0xffff) {
    return isPrivateIPv4([parts[6] >> 8, parts[6] & 0xff, parts[7] >> 8, parts[7] & 0xff])
  }
  if ((head & 0xfe00) === 0xfc00) return true // fc00::/7 ULA
  if ((head & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  return false
}

/** Whether an IP literal (v4 or v6) is on a private/loopback network. */
export function isPrivateIP(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const octets = address.split('.').map(Number)
    return isPrivateIPv4(octets)
  }
  if (version === 6) {
    const parts = parseIPv6(address)
    return parts !== undefined && isPrivateIPv6(parts)
  }
  return false
}

/** Parse an IPv6 literal into 8 16-bit parts (handles :: compression and mapped tails). */
function parseIPv6(address: string): number[] | undefined {
  const lower = address.toLowerCase()
  const mapped = lower.includes('.') // IPv4-mapped tail like ::ffff:127.0.0.1
  let head = lower
  let tail: number[] | undefined
  if (mapped) {
    const at = lower.lastIndexOf(':')
    const v4 = lower.slice(at + 1)
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return undefined
    const octets = v4.split('.').map(Number)
    if (octets.some(o => o > 255)) return undefined
    head = lower.slice(0, at)
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]]
  }
  const groups = head.split('::')
  if (groups.length > 2) return undefined
  const parse = (part: string): number[] => {
    if (part === '') return []
    return part.split(':').map(g => {
      if (!/^[0-9a-f]{1,4}$/.test(g)) throw new Error('bad group')
      return parseInt(g, 16)
    })
  }
  let parts: number[]
  try {
    if (groups.length === 2) {
      const left = parse(groups[0])
      const right = parse(groups[1])
      const missing = 8 - left.length - right.length - (tail?.length ?? 0)
      if (missing < 0) return undefined
      parts = [...left, ...new Array(missing).fill(0), ...right]
      if (tail !== undefined) parts = [...parts, ...tail]
    } else {
      parts = parse(groups[0])
      if (parts.length > 8) return undefined
      if (tail !== undefined) {
        if (parts.length > 6) return undefined
        parts = [...parts, ...tail]
      }
    }
  } catch {
    return undefined
  }
  return parts.length === 8 ? parts : undefined
}

/** Normalize a bracketed/hex IPv4-mapped literal back to dotted quad. */
function normalizeMapped(hostname: string): string {
  const lower = hostname.toLowerCase()
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower)
  if (m !== null) return m[1]
  // Hex form like ::ffff:a00:1 -> expand to dotted quad.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (hex !== null) {
    const a = parseInt(hex[1], 16)
    const b = parseInt(hex[2], 16)
    return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`
  }
  return hostname
}

/** Whether a hostname (not an IP literal) is a local/private name. */
function isLocalName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === 'localhost.localdomain' || name.endsWith('.localhost')
}

/**
 * Validate a URL for image fetching: rejects credentials in the URL, and —
 * unless private networks are allowed — rejects private IP literals, local
 * names, and any DNS resolution that lands on a private address.
 * @param urlText - the URL to validate.
 * @param allowPrivateNetwork - explicit opt-in for private hosts.
 * @param resolve - DNS resolver override (tests); defaults to node:dns lookup.
 * @returns the parsed URL on success.
 */
export async function validateImageUrl(
  urlText: string,
  allowPrivateNetwork: boolean,
  resolve: (hostname: string) => Promise<string[]> = async (hostname) => {
    const records = await lookup(hostname, { all: true })
    return records.map(record => record.address)
  },
): Promise<URL> {
  let url: URL
  try {
    url = new URL(urlText)
  } catch {
    throw new Error(`image-mind: image URL is not valid: ${safeUrlExcerpt(urlText)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('image-mind: only http(s) URLs are supported for image fetching')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('image-mind: image URLs must not carry embedded credentials')
  }
  if (allowPrivateNetwork) return url
  // WHATWG URLs bracket IPv6 literals and normalize IPv4-mapped tails to
  // hex (::ffff:a00:1); strip the brackets and normalize for classification.
  const rawHost = url.hostname
  const hostname = rawHost.replace(/^\[|\]$/g, '')
  const ip = isIP(hostname)
  if (ip !== 0) {
    const classified = normalizeMapped(hostname)
    if (isPrivateIP(classified)) {
      throw new Error(`image-mind: image URL points to a private network host (${hostname}); set allowPrivateNetwork to fetch it`)
    }
    return url
  }
  if (isLocalName(hostname)) {
    throw new Error(`image-mind: image URL points to a private network host (${hostname}); set allowPrivateNetwork to fetch it`)
  }
  // DNS pre-resolution: any A/AAAA record landing private rejects the URL.
  let addresses: string[]
  try {
    addresses = await resolve(hostname)
  } catch {
    throw new Error(`image-mind: image URL host could not be resolved (${hostname})`)
  }
  for (const address of addresses) {
    if (isPrivateIP(address)) {
      throw new Error(`image-mind: image URL resolves to a private network host (${hostname} -> ${address}); set allowPrivateNetwork to fetch it`)
    }
  }
  return url
}

/** A safe excerpt of a URL for errors: origin + pathname, query and hash stripped. */
export function safeUrlExcerpt(urlText: string): string {
  try {
    const url = new URL(urlText)
    return `${url.origin}${url.pathname}`
  } catch {
    return urlText.slice(0, 96)
  }
}
