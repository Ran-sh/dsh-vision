/**
 * Browser half of the attach seam: the upload client for the host
 * /image-mind/attach route. The browser sends the picked image as base64
 * text; the host validates magic bytes, persists the bytes in the attachment
 * store, and returns the markdown reference the send hook splices into the
 * prompt. Image bytes never enter the conversation log.
 * @module dsh-plugin-image-mind/client/attach
 */

/** The host attach endpoint, same-origin with the web shell. */
export const ATTACH_ENDPOINT = '/image-mind/attach'

/** Image media types offered for upload (mirrors the host gate). */
export const ACCEPTED_IMAGE_MIME: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Client-side byte bound, matching the host default; the host re-checks. */
export const CLIENT_MAX_BYTES = 10 * 1024 * 1024

/**
 * Read a picked file as base64 text (no data-URL prefix).
 * @param file - the file the user picked.
 * @returns the base64 payload, or a structured rejection.
 */
export function readFileAsBase64(file: File): Promise<{ ok: true; base64: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve({ ok: false, message: 'read-failed' })
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      if (comma < 0) {
        resolve({ ok: false, message: 'read-failed' })
        return
      }
      resolve({ ok: true, base64: result.slice(comma + 1) })
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Upload base64 image bytes to the host attach route.
 * @param base64 - the base64 image payload.
 * @param mediaType - the declared media type (verified against magic bytes on the host).
 * @param name - optional display name.
 * @returns the markdown reference for the send, or a structured rejection.
 */
export async function uploadImage(
  base64: string,
  mediaType: string,
  name?: string,
): Promise<{ ok: true; note: string; markdown: string } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetch(ATTACH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: base64, mediaType, ...name === undefined ? {} : { name } }),
    })
  } catch {
    return { ok: false, message: 'network-failed' }
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    return { ok: false, message: 'bad-response' }
  }
  const record = envelope as { ok?: unknown; value?: unknown; error?: unknown } | null
  if (typeof record !== 'object' || record === null) return { ok: false, message: 'bad-response' }
  if (record.ok === true && typeof record.value === 'object' && record.value !== null) {
    const value = record.value as { note?: unknown; markdown?: unknown }
    if (typeof value.note === 'string' && value.note !== '') {
      return { ok: true, note: value.note, markdown: typeof value.markdown === 'string' ? value.markdown : value.note }
    }
    return { ok: false, message: 'bad-response' }
  }
  const message = (record.error as { message?: unknown } | null)?.message
  return { ok: false, message: typeof message === 'string' && message !== '' ? message : 'server-failed' }
}

/* ------------------------------------------------------------------ *
 * Content-aware downscaling before upload. Vision endpoints bill by pixel
 * count, but text-heavy screenshots lose useful OCR/UI detail much faster
 * than photographs when they are aggressively resized or JPEG-encoded.
 * PNGs therefore keep a larger long edge and remain lossless PNG; JPEG/WebP
 * use the smaller photographic budget and JPEG encoding. Any decode/encode
 * failure degrades to the original bytes. Animated GIFs are never touched.
 * ------------------------------------------------------------------ */

/** Longest-edge cap for photographic/lossy images scaled before upload. */
export const LOSSY_COMPRESS_MAX_EDGE = 2048
/** Longest-edge cap for PNG screenshots/documents, preserving small text. */
export const PNG_COMPRESS_MAX_EDGE = 3072
/** Backward-compatible name for callers that treated the old cap as photographic. */
export const COMPRESS_MAX_EDGE = LOSSY_COMPRESS_MAX_EDGE
/** Only images above this raw byte size are considered for scaling. */
export const COMPRESS_MIN_BYTES = 1.5 * 1024 * 1024
/** JPEG quality used for photographic downscale. */
const COMPRESS_JPEG_QUALITY = 0.85

/** Pure preprocessing decision, exported so the quality contract is testable. */
export interface ImagePreprocessPolicy {
  maxEdge: number
  outputType: 'image/png' | 'image/jpeg'
  quality?: number
}

/**
 * Pick a fidelity policy from the source media type.
 * PNG is treated as screenshot/document-friendly: retain more pixels and do
 * not introduce JPEG ringing around text. JPEG/WebP remain cost-optimized.
 */
export function imagePreprocessPolicy(mediaType: string): ImagePreprocessPolicy | undefined {
  if (mediaType === 'image/png') {
    return { maxEdge: PNG_COMPRESS_MAX_EDGE, outputType: 'image/png' }
  }
  if (mediaType === 'image/jpeg' || mediaType === 'image/webp') {
    return { maxEdge: LOSSY_COMPRESS_MAX_EDGE, outputType: 'image/jpeg', quality: COMPRESS_JPEG_QUALITY }
  }
  return undefined
}

/** A picked image prepared for upload: possibly downscaled, always base64. */
export type PreparedImage =
  | { ok: true; base64: string; mediaType: string }
  | { ok: false; message: string }

/** Read any Blob (or File) as a base64 payload without the data-URL prefix. */
function readBlobAsBase64(blob: Blob): Promise<{ ok: true; base64: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve({ ok: false, message: 'read-failed' })
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      if (comma < 0) {
        resolve({ ok: false, message: 'read-failed' })
        return
      }
      resolve({ ok: true, base64: result.slice(comma + 1) })
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Read a picked image and downscale it when it is oversized, so the vision
 * model is billed only for useful resolution. PNG screenshots/documents keep
 * a larger 3072px edge and lossless encoding; JPEG/WebP photos use 2048px
 * JPEG. GIFs and small images pass through untouched. Every processing
 * failure degrades to the original.
 * @param file - the picked image file.
 * @returns the base64 payload and the media type to upload (may differ from
 *   the source after re-encoding).
 */
export async function prepareImageForDescribe(file: File): Promise<PreparedImage> {
  const raw = await readFileAsBase64(file)
  if (!raw.ok) return raw
  const policy = imagePreprocessPolicy(file.type)
  const compressible = policy !== undefined && file.size > COMPRESS_MIN_BYTES
  if (!compressible || policy === undefined) return { ok: true, base64: raw.base64, mediaType: file.type }

  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    const edge = Math.max(bitmap.width, bitmap.height)
    if (edge <= policy.maxEdge || bitmap.width === 0 || bitmap.height === 0) {
      bitmap.close()
      return { ok: true, base64: raw.base64, mediaType: file.type }
    }
    const scale = policy.maxEdge / edge
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) {
      bitmap.close()
      return { ok: true, base64: raw.base64, mediaType: file.type }
    }
    // Only JPEG needs an opaque background. PNG keeps transparency and,
    // importantly, avoids lossy ringing around small screenshot/document text.
    if (policy.outputType === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, policy.outputType, policy.quality)
    })
    if (blob === null) return { ok: true, base64: raw.base64, mediaType: file.type }
    const down = await readBlobAsBase64(blob)
    if (!down.ok || down.base64.length >= raw.base64.length) {
      return { ok: true, base64: raw.base64, mediaType: file.type }
    }
    return { ok: true, base64: down.base64, mediaType: policy.outputType }
  } catch {
    try { bitmap?.close() } catch { /* double-close is a no-op; ignore */ }
    return { ok: true, base64: raw.base64, mediaType: file.type }
  }
}
