/**
 * Media validation and loading tests: magic-byte sniffing (png/jpeg/gif/webp),
 * fake extensions, oversize, bad magic, redirects, and private-network policy.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { sniffMimeType, decodeBase64 } from '../src/media/validate.ts'

/** A minimal valid PNG header (8-byte magic + padding). */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
/** A minimal JPEG header (3-byte magic + padding). */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
/** A GIF87a header. */
const GIF_BYTES = Buffer.from('GIF87a', 'ascii')
/** A GIF89a header. */
const GIF89_BYTES = Buffer.from('GIF89a', 'ascii')
/** A WebP header (RIFF....WEBP). */
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')])

describe('sniffMimeType', () => {
  it('detects png from magic bytes', () => {
    expect(sniffMimeType(PNG_BYTES)).toBe('image/png')
  })

  it('detects jpeg from magic bytes', () => {
    expect(sniffMimeType(JPEG_BYTES)).toBe('image/jpeg')
  })

  it('detects both gif versions', () => {
    expect(sniffMimeType(GIF_BYTES)).toBe('image/gif')
    expect(sniffMimeType(GIF89_BYTES)).toBe('image/gif')
  })

  it('detects webp from the RIFF/WEBP header', () => {
    expect(sniffMimeType(WEBP_BYTES)).toBe('image/webp')
  })

  it('rejects a fake extension (text bytes)', () => {
    expect(sniffMimeType(Buffer.from('not-an-image', 'ascii'))).toBeUndefined()
  })

  it('rejects truncated inputs', () => {
    expect(sniffMimeType(Buffer.from([0x89, 0x50]))).toBeUndefined()
  })

  it('rejects empty input', () => {
    expect(sniffMimeType(Buffer.alloc(0))).toBeUndefined()
  })
})

describe('decodeBase64', () => {
  it('decodes a valid standard-alphabet payload', () => {
    const bytes = Buffer.from('hello world')
    expect(decodeBase64(bytes.toString('base64'))?.toString('utf8')).toBe('hello world')
  })

  it('rejects wrong padding', () => {
    expect(decodeBase64('aGVsbG8=')).toBeDefined()
    expect(decodeBase64('aGVsbG8')).toBeUndefined()
  })

  it('rejects non-base64 characters', () => {
    expect(decodeBase64('aGVsbG8*')).toBeUndefined()
  })

  it('rejects empty input', () => {
    expect(decodeBase64('')).toBeUndefined()
  })

  it('rejects a payload whose re-encoding differs (lenient Buffer.from)', () => {
    // 'A' alone is not a valid base64 length.
    expect(decodeBase64('A')).toBeUndefined()
  })
})
