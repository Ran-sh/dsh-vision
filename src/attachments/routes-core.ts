/**
 * Attachment route core: upload validation and store persistence, shared by
 * the route handler. Pure functions where possible; the store write is the
 * only I/O.
 * @module dsh-plugin-image-mind/attachments/routes-core
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { decodeBase64, isImageMimeType, sniffMimeType, type ImageMimeType } from '../media/validate.ts'
import { registerAttachmentRef, attachmentMarkdown, attachmentNote } from './store.ts'

/** Stable error codes the browser half surfaces without leaking internals. */
export interface AttachError {
  /** `rejected`: the image or payload fails validation; `internal`: the route or store failed. */
  code: 'rejected' | 'internal'
  message: string
}

/** Validated upload payload. */
export interface AttachPayload {
  /** Base64-encoded image bytes (standard alphabet). */
  data: string
  /** Media type the sender declares; verified against magic bytes. */
  mediaType: ImageMimeType
  /** Optional display name; never interpreted as a path. */
  name?: string
}

/** Outcome of one attach attempt. */
export type AttachOutcome =
  | { ok: true; ref: ImageAttachmentRef; note: string; markdown: string }
  | { ok: false; error: AttachError }

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Validate an unknown upload payload and decode its bytes. Pure: no context,
 * no I/O — every rejection reason is spelled in the error message.
 * @param payload - the parsed request body.
 * @param maxBytes - the image byte bound.
 * @returns the validated payload and decoded bytes, or the rejection.
 */
export function validateAttachPayload(payload: unknown, maxBytes: number): { payload: AttachPayload; bytes: Buffer } | { error: AttachError } {
  const record = asRecord(payload)
  if (record === undefined) {
    return { error: { code: 'internal', message: 'request body must be a JSON object' } }
  }
  const { data, mediaType, name } = record
  if (typeof data !== 'string' || data.length === 0) {
    return { error: { code: 'rejected', message: 'image data must be a non-empty base64 string' } }
  }
  if (!isImageMimeType(mediaType)) {
    return { error: { code: 'rejected', message: 'mediaType must be one of image/png, image/jpeg, image/gif, image/webp' } }
  }
  if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
    return { error: { code: 'rejected', message: 'name must be a non-empty string when present' } }
  }
  const bytes = decodeBase64(data)
  if (bytes === undefined) {
    return { error: { code: 'rejected', message: 'image data is not valid base64' } }
  }
  if (bytes.length === 0) {
    return { error: { code: 'rejected', message: 'image data is empty' } }
  }
  if (bytes.length > maxBytes) {
    return { error: { code: 'rejected', message: `image is ${bytes.length} bytes, above the ${maxBytes}-byte bound` } }
  }
  if (sniffMimeType(bytes) !== mediaType) {
    return { error: { code: 'rejected', message: `bytes do not match the declared ${mediaType} type` } }
  }
  return { payload: { data, mediaType, ...name === undefined ? {} : { name } }, bytes }
}

/**
 * Validate and persist one upload. The declared media type is checked against
 * magic bytes before any store write; the store's own validation runs before
 * the reference is published.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param maxBytes - the image byte bound.
 * @param payload - the parsed request body.
 * @returns the stored reference and its note text, or a structured rejection.
 */
export async function handleAttach(ctx: Context, maxBytes: number, payload: unknown): Promise<AttachOutcome> {
  const validated = validateAttachPayload(payload, maxBytes)
  if ('error' in validated) return { ok: false, error: validated.error }
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    return { ok: false, error: { code: 'internal', message: 'the attachment service is not mounted; the route cannot store images' } }
  }
  try {
    const ref = await attachments.saveImage({
      data: validated.bytes,
      mediaType: validated.payload.mediaType,
      ...validated.payload.name === undefined ? {} : { name: validated.payload.name },
    })
    registerAttachmentRef(ref)
    return { ok: true, ref, note: attachmentNote(ref), markdown: attachmentMarkdown(ref.attachmentId) }
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: `attachment store rejected the image: ${(error as Error).message ?? String(error)}` } }
  }
}

export { decodeBase64, isImageMimeType, sniffMimeType }
export type { ImageMimeType }
