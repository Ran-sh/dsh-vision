/**
 * Attachment reference facts: parsing a model-supplied `[image attachment …]`
 * JSON into its typed storage form, the in-memory registry of references this
 * process persisted (so a bare `sha256:…` id text models copy out of the
 * markdown reference still resolves), and the note/markdown text builders.
 * @module dsh-plugin-image-mind/attachments/store
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { isImageMimeType } from '../media/validate.ts'

/** The host route prefix both halves agree on. */
export const ROUTE_PREFIX = '/image-mind'

/** Error text shown when a model-supplied attachment reference does not validate. */
const ATTACHMENT_REF_GUIDANCE =
  'image-mind: image is not a valid attachment reference; copy the exact JSON from the [image attachment …] note'

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Whether a record field holds a positive safe integer. */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** A non-empty string from a record under `key`, else undefined. */
function nonEmptyString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Validate and narrow a model-supplied attachment reference into its typed
 * storage form. Every field is re-checked (the schema is authoritative, not a
 * cast), and a misshaped value fails with the copy-verbatim guidance.
 * @param raw - the JSON the model copied from an `[image attachment …]` note.
 * @returns the narrowed, typed reference.
 */
export function parseImageAttachmentRef(raw: string): ImageAttachmentRef {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(ATTACHMENT_REF_GUIDANCE)
  }
  const record = asRecord(parsed)
  if (record === undefined) throw new Error(ATTACHMENT_REF_GUIDANCE)
  const attachmentId = nonEmptyString(record, 'attachmentId')
  const mediaType = record['mediaType']
  const bytes = record['bytes']
  const width = record['width']
  const height = record['height']
  const name = record['name']
  if (attachmentId === undefined
    || !isImageMimeType(mediaType)
    || !isPositiveSafeInteger(bytes)
    || !isPositiveSafeInteger(width)
    || !isPositiveSafeInteger(height)
    || (name !== undefined && typeof name !== 'string')) {
    throw new Error(ATTACHMENT_REF_GUIDANCE)
  }
  const ref: ImageAttachmentRef = {
    attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType,
    bytes,
    width,
    height,
    ...name === undefined ? {} : { name },
  }
  return ref
}

/**
 * In-memory registry of references this process's attach route persisted,
 * keyed by attachment id. Text models that copy only the id out of the
 * markdown image reference (instead of the whole JSON) still resolve through
 * here, and the attachment store's digest verification runs on the read
 * regardless. Bounded FIFO; ids are content-addressed so a stale entry cannot
 * be confused with another image.
 */
const ATTACHMENT_REF_REGISTRY = new Map<string, ImageAttachmentRef>()

/** Registry capacity; beyond it the oldest entry is dropped. */
const ATTACHMENT_REF_REGISTRY_CAP = 128

/** Remember one persisted reference by its attachment id. */
export function registerAttachmentRef(ref: ImageAttachmentRef): void {
  ATTACHMENT_REF_REGISTRY.delete(ref.attachmentId)
  ATTACHMENT_REF_REGISTRY.set(ref.attachmentId, ref)
  while (ATTACHMENT_REF_REGISTRY.size > ATTACHMENT_REF_REGISTRY_CAP) {
    const oldest = ATTACHMENT_REF_REGISTRY.keys().next().value
    if (oldest === undefined) break
    ATTACHMENT_REF_REGISTRY.delete(oldest)
  }
}

/** Look up a persisted reference by its bare attachment id, if still in the registry. */
export function attachmentRefById(id: string): ImageAttachmentRef | undefined {
  return ATTACHMENT_REF_REGISTRY.get(id)
}

/**
 * The markdown image reference inserted into the send: short, renders as an
 * image in the conversation, and carries the attachment id in the URL so a
 * text model can extract it and hand it to understand_image (the tool
 * resolves bare ids through the registry).
 * @param id - the attachment id (e.g. `sha256:…`).
 * @returns the markdown text to splice into the send.
 */
export function attachmentMarkdown(id: string): string {
  // The `:` of `sha256:…` stays readable and extractable for the model;
  // everything else is escaped for the path segment.
  return `![图片](${ROUTE_PREFIX}/raw/${encodeURIComponent(id).replace(/%3A/gi, ':')})`
}

/** Build the `[image attachment …]` note text for one reference. */
export function attachmentNote(ref: ImageAttachmentRef): string {
  return `[image attachment ${JSON.stringify(ref)}]`
}
