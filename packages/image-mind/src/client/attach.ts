/**
 * Browser half of the attach seam: upload + content-aware image preparation.
 * Image bytes stay outside the conversation log; the host persists validated
 * attachments and returns semantic references.
 */

export const ATTACH_ENDPOINT = '/image-mind/attach'
export const PREVIEW_COMMIT_ENDPOINT = '/image-mind/preview/commit'
export const PREVIEW_DISCARD_ENDPOINT = '/image-mind/preview/discard'
export const PREVIEW_LIST_ENDPOINT = '/image-mind/previews'
export const ACCEPTED_IMAGE_MIME: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const CLIENT_MAX_BYTES = 10 * 1024 * 1024

export interface UploadRouting {
  sessionId: string
  batchId: string
  batchIndex: number
  batchCount: number
}

export interface SessionPreviewBatch {
  batchId: string
  count: number
  updatedAt: number
}

export function previewImageUrl(batchId: string, batchIndex: number): string {
  return `/image-mind/preview/${encodeURIComponent(batchId)}/${batchIndex}`
}

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

export async function uploadImage(
  base64: string,
  mediaType: string,
  name?: string,
  routing?: UploadRouting,
): Promise<{ ok: true; note: string; markdown: string } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetch(ATTACH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: base64,
        mediaType,
        ...name === undefined ? {} : { name },
        ...routing === undefined ? {} : routing,
      }),
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

/** Commit a just-admitted image batch to the display-only preview ledger. */
export async function commitImagePreviewBatch(
  sessionId: string,
  batchId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetch(PREVIEW_COMMIT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, batchId }),
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
  const record = envelope as { ok?: unknown; error?: unknown } | null
  if (typeof record === 'object' && record !== null && record.ok === true) return { ok: true }
  const message = (record?.error as { message?: unknown } | null)?.message
  return { ok: false, message: typeof message === 'string' && message !== '' ? message : 'server-failed' }
}

/** Best-effort removal of an uncommitted routing batch after a failed send. */
export async function discardImageRoutingBatch(
  sessionId: string,
  batchId: string,
): Promise<{ ok: true; discarded: boolean } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetch(PREVIEW_DISCARD_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, batchId }),
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
  if (typeof record === 'object' && record !== null && record.ok === true) {
    const value = record.value as { discarded?: unknown } | null
    return { ok: true, discarded: value?.discarded === true }
  }
  const message = (record?.error as { message?: unknown } | null)?.message
  return { ok: false, message: typeof message === 'string' && message !== '' ? message : 'server-failed' }
}

/** Fetch committed preview batches for one currently selected DSH session. */
export async function loadSessionPreviewBatches(sessionId: string): Promise<SessionPreviewBatch[]> {
  let response: Response
  try {
    response = await fetch(`${PREVIEW_LIST_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
  } catch {
    return []
  }
  if (!response.ok) return []
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    return []
  }
  const record = envelope as { ok?: unknown; value?: unknown } | null
  if (typeof record !== 'object' || record === null || record.ok !== true) return []
  const value = record.value as { batches?: unknown } | null
  if (typeof value !== 'object' || value === null || !Array.isArray(value.batches)) return []
  const batches: SessionPreviewBatch[] = []
  for (const raw of value.batches) {
    if (typeof raw !== 'object' || raw === null) continue
    const batch = raw as Record<string, unknown>
    const batchId = batch['batchId']
    const count = batch['count']
    const updatedAt = batch['updatedAt']
    if (typeof batchId !== 'string' || batchId.length === 0) continue
    if (!Number.isSafeInteger(count) || (count as number) <= 0 || (count as number) > 8) continue
    if (!Number.isSafeInteger(updatedAt) || (updatedAt as number) < 0) continue
    batches.push({ batchId, count: count as number, updatedAt: updatedAt as number })
  }
  return batches
}

/** Normal photo/panoramic edge budget. */
export const LOSSY_COMPRESS_MAX_EDGE = 2048
/** Normal PNG screenshot/document edge budget. */
export const PNG_COMPRESS_MAX_EDGE = 3072
/** Tall/wide screenshot budget: more edge length without exceeding pixel cap. */
export const PNG_LONG_COMPRESS_MAX_EDGE = 8192
/** Total PNG pixel budget, independent of aspect ratio. */
export const PNG_MAX_PIXELS = 10 * 1024 * 1024
/** Aspect ratio at which a PNG is treated as a long screenshot/document. */
export const LONG_SCREENSHOT_ASPECT_RATIO = 2.5
/** Kept as a public compatibility constant; dimension policy is now authoritative. */
export const COMPRESS_MIN_BYTES = 1.5 * 1024 * 1024
export const COMPRESS_MAX_EDGE = LOSSY_COMPRESS_MAX_EDGE
const COMPRESS_JPEG_QUALITY = 0.85

export interface ImagePreprocessPolicy {
  maxEdge: number
  maxPixels?: number
  outputType: 'image/png' | 'image/jpeg'
  quality?: number
}

/**
 * Select a fidelity budget. Optional dimensions let long PNG screenshots keep
 * substantially more edge resolution while a pixel cap prevents runaway cost.
 */
export function imagePreprocessPolicy(
  mediaType: string,
  width?: number,
  height?: number,
): ImagePreprocessPolicy | undefined {
  if (mediaType === 'image/png') {
    const validDimensions = Number.isFinite(width) && Number.isFinite(height) && (width ?? 0) > 0 && (height ?? 0) > 0
    const aspect = validDimensions ? Math.max(width!, height!) / Math.min(width!, height!) : 1
    return {
      maxEdge: aspect >= LONG_SCREENSHOT_ASPECT_RATIO ? PNG_LONG_COMPRESS_MAX_EDGE : PNG_COMPRESS_MAX_EDGE,
      maxPixels: PNG_MAX_PIXELS,
      outputType: 'image/png',
    }
  }
  if (mediaType === 'image/jpeg' || mediaType === 'image/webp') {
    return { maxEdge: LOSSY_COMPRESS_MAX_EDGE, outputType: 'image/jpeg', quality: COMPRESS_JPEG_QUALITY }
  }
  return undefined
}

/** Pure target-size calculation used by browser code and regression tests. */
export function targetImageDimensions(
  width: number,
  height: number,
  policy: ImagePreprocessPolicy,
): { width: number; height: number; scaled: boolean } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width, height, scaled: false }
  }
  const edge = Math.max(width, height)
  const edgeScale = Math.min(1, policy.maxEdge / edge)
  const pixels = width * height
  const pixelScale = policy.maxPixels === undefined
    ? 1
    : Math.min(1, Math.sqrt(policy.maxPixels / pixels))
  const scale = Math.min(edgeScale, pixelScale)
  if (scale >= 1) return { width: Math.round(width), height: Math.round(height), scaled: false }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  }
}

export type PreparedImage =
  | { ok: true; base64: string; mediaType: string }
  | { ok: false; message: string }

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
 * Decode supported still images once, calculate a dimension-aware budget, and
 * scale only when the pixel geometry exceeds it. This intentionally no longer
 * requires the re-encoded file to be smaller than the original compressed
 * bytes: a highly compressed but enormous screenshot still needs fewer pixels
 * for reliable/cost-bounded vision processing.
 */
export async function prepareImageForDescribe(file: File): Promise<PreparedImage> {
  const raw = await readFileAsBase64(file)
  if (!raw.ok) return raw
  if (file.type !== 'image/png' && file.type !== 'image/jpeg' && file.type !== 'image/webp') {
    return { ok: true, base64: raw.base64, mediaType: file.type }
  }

  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    const policy = imagePreprocessPolicy(file.type, bitmap.width, bitmap.height)
    if (policy === undefined) {
      bitmap.close()
      return { ok: true, base64: raw.base64, mediaType: file.type }
    }
    const target = targetImageDimensions(bitmap.width, bitmap.height, policy)
    if (!target.scaled) {
      bitmap.close()
      return { ok: true, base64: raw.base64, mediaType: file.type }
    }

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (context === null) {
      bitmap.close()
      return { ok: true, base64: raw.base64, mediaType: file.type }
    }
    if (policy.outputType === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, target.width, target.height)
    }
    context.drawImage(bitmap, 0, 0, target.width, target.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, policy.outputType, policy.quality)
    })
    if (blob === null || blob.size > CLIENT_MAX_BYTES) {
      return { ok: true, base64: raw.base64, mediaType: file.type }
    }
    const down = await readBlobAsBase64(blob)
    if (!down.ok) return { ok: true, base64: raw.base64, mediaType: file.type }
    return { ok: true, base64: down.base64, mediaType: policy.outputType }
  } catch {
    try { bitmap?.close() } catch { /* ignore cleanup failure */ }
    return { ok: true, base64: raw.base64, mediaType: file.type }
  }
}
