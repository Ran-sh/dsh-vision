/**
 * Image validation: the magic-byte gate and the strict base64 decoder. Pure —
 * no I/O, no context — so the attach route, the media loader, and tests all
 * share one gate.
 * @module dsh-plugin-image-mind/media/validate
 */

import { isImageMimeType, type ImageMimeType } from './types.ts'

/**
 * Detect the image media type from magic bytes.
 * @param bytes - the leading bytes of the input.
 * @returns the accepted media type, or `undefined` for unknown or truncated inputs.
 */
export function sniffMimeType(bytes: Buffer): ImageMimeType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

/**
 * Strictly decode a base64 payload: the standard alphabet, correct padding,
 * and a length that is a multiple of four. Rejects anything `Buffer.from`
 * would silently tolerate.
 * @param encoded - the base64 text.
 * @returns the decoded bytes, or `undefined` when the text is not valid base64.
 */
export function decodeBase64(encoded: string): Buffer | undefined {
  if (encoded.length === 0 || encoded.length % 4 !== 0) return undefined
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return undefined
  if (/=/.test(encoded) && !/={1,2}$/.test(encoded)) return undefined
  const bytes = Buffer.from(encoded, 'base64')
  // Buffer.from is lenient; re-encoding must reproduce the input exactly.
  if (bytes.toString('base64') !== encoded) return undefined
  return bytes
}

export { isImageMimeType }
export type { ImageMimeType }
