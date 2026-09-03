/**
 * Image loading: one image from an http(s) URL, an attachment reference JSON,
 * a bare attachment id taken out of a markdown image reference, or — only
 * when local files are explicitly enabled and the path resolves inside an
 * allow-listed root — an absolute local path. Enforces the byte bound and the
 * network policy before any bytes reach the vision model. Non-http(s) URL
 * schemes are rejected; private network hosts are refused unless
 * `allowPrivateNetwork` is set (localhost is always allowed — Ollama / LM
 * Studio are local vision endpoints). Local filesystem reads are disabled by
 * default (see `media/local-file-policy`).
 * @module dsh-plugin-image-mind/media/load
 */

import { readFile, stat } from 'node:fs/promises'
import { validateImageUrl } from './network.ts'
import { isAuthorizedLocalPath, resolveAuthorizedLocalFile } from './local-file-policy.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { attachmentRefById, parseImageAttachmentRef } from '../attachments/store.ts'
import { durableAttachmentRefById } from '../attachments/ref-index.ts'
import { isImageMimeType, sniffMimeType, type ImageMimeType } from './validate.ts'
import type { LoadedImage } from './types.ts'

export type { LoadedImage }

/** Error text shown when a model-supplied attachment reference does not validate. */
const ATTACHMENT_REF_GUIDANCE =
  'image-mind: image is not a valid attachment reference; copy the exact JSON from the [image attachment …] note'

/** Whether `error` carries the attachment store not-found marker. */
function isAttachmentNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { code?: unknown }).code === 'ATTACHMENT_NOT_FOUND'
}

/**
 * Read a stored attachment through the attachment service and return its
 * verified bytes.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param ref - the typed attachment reference.
 * @param signal - caller cancellation.
 * @returns the verified stored bytes.
 */
async function readAttachmentRef(ctx: Context, ref: ImageAttachmentRef, signal: AbortSignal): Promise<Buffer> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('image-mind: no attachment service is mounted; pass a file path or URL instead')
  }
  try {
    const stored = await attachments.readImage(ref, signal)
    return Buffer.from(stored.data)
  } catch (error) {
    if (isAttachmentNotFound(error)) {
      throw new Error(`image-mind: attachment ${JSON.stringify(ref.attachmentId)} is no longer available`)
    }
    throw error
  }
}

/** Sniff the media type and reject empty or unsupported inputs. */
function toImage(bytes: Buffer, source: string): LoadedImage {
  if (bytes.length === 0) throw new Error(`image-mind: image is empty: ${source}`)
  const mimeType = sniffMimeType(bytes)
  if (mimeType === undefined) {
    throw new Error(`image-mind: unsupported image type (expected PNG, JPEG, GIF, or WebP): ${source}`)
  }
  return { bytes, mimeType }
}

/** Enforce the byte bound on already-loaded bytes. */
function assertWithinBound(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) {
    throw new Error(`image-mind: image is ${bytes} bytes, above the ${maxBytes}-byte bound`)
  }
}

// Private-network policy moved to media/network.ts (proper IP classification
// + DNS pre-resolution); this module only orchestrates loading.

/**
 * Load one image from an http(s) URL, an attachment reference JSON, a bare
 * attachment id, or — only when the deployment has explicitly enabled local
 * files and the path resolves inside an allow-listed root — an absolute local
 * path. Enforces the byte bound, the local-file policy, and the
 * private-network policy before any bytes reach the vision model.
 * @param ctx - registrant context; supplies the optional attachment service.
 * @param input - the model-supplied image reference.
 * @param signal - caller cancellation.
 * @param maxBytes - image byte bound.
 * @param options - network and local-file policy.
 * @returns the loaded bytes and sniffed media type.
 */
export async function loadImage(
  ctx: Context,
  input: string,
  signal: AbortSignal,
  maxBytes: number,
  options?: { allowPrivateNetwork?: boolean; allowLocalFiles?: boolean; localFileRoots?: readonly string[] },
): Promise<LoadedImage> {
  const allowPrivateNetwork = options?.allowPrivateNetwork ?? false
  const allowLocalFiles = options?.allowLocalFiles ?? false
  const localFileRoots = options?.localFileRoots ?? []
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new Error('image-mind: image must be a non-empty path, URL, or attachment reference')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('image-mind: only http(s) URLs, local file paths, and attachment references are supported')
  }
  if (trimmed.startsWith('{')) {
    const ref = parseImageAttachmentRef(trimmed)
    const bytes = await readAttachmentRef(ctx, ref, signal)
    assertWithinBound(bytes.length, maxBytes)
    return toImage(bytes, trimmed.slice(0, 96))
  }
  if (/^https?:\/\//i.test(trimmed)) {
    // SSRF guard: private IP literals (v4/v6/mapped), local names, and DNS
    // pre-resolution landing private all reject unless explicitly allowed;
    // embedded URL credentials are refused; redirects stay rejected.
    await validateImageUrl(trimmed, allowPrivateNetwork)
    const response = await fetch(trimmed, { signal, redirect: 'error' })
    if (!response.ok) {
      throw new Error(`image-mind: image fetch returned HTTP ${response.status}`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isSafeInteger(declared) && declared > maxBytes) {
      throw new Error(`image-mind: image is ${declared} bytes, above the ${maxBytes}-byte bound`)
    }
    const bytes = await readBoundedBody(response, maxBytes)
    return toImage(bytes, trimmed)
  }
  // A bare attachment id — first use the process cache, then the metadata-only
  // durable index. The actual bytes still come from DSH's attachment backend
  // and its digest/metadata verification runs on every read.
  const registered = attachmentRefById(trimmed) ?? await durableAttachmentRefById(ctx, trimmed)
  if (registered !== undefined) {
    const bytes = await readAttachmentRef(ctx, registered, signal)
    assertWithinBound(bytes.length, maxBytes)
    return toImage(bytes, trimmed)
  }
  if (/^sha256:/i.test(trimmed)) {
    throw new Error(
      'image-mind: the image attachment ' + JSON.stringify(trimmed.slice(0, 64))
      + ' is unavailable or has no validated metadata; ask the user to re-send the image',
    )
  }
  // Filesystem access is a host capability boundary: denied unless the
  // deployment opted in and the real path stays inside an allow-listed root.
  if (!isAuthorizedLocalPath(trimmed, allowLocalFiles, localFileRoots)) {
    throw new Error(
      'image-mind: local file paths are disabled for image references; send the image as a session attachment, '
      + 'or reference it by http(s) URL or attachment id',
    )
  }
  const path = await resolveAuthorizedLocalFile(trimmed, localFileRoots)
  const info = await stat(path, { bigint: false })
  if (!info.isFile()) throw new Error(`image-mind: image path is not a file: ${trimmed}`)
  assertWithinBound(info.size, maxBytes)
  const bytes = await readFile(path, { signal })
  return toImage(bytes, trimmed)
}

/**
 * Read a response body up to a byte cap, rejecting the whole response beyond it.
 * @param response - the response to drain.
 * @param cap - the byte bound.
 * @returns the accumulated body bytes.
 */
export async function readBoundedBody(response: Response, cap: number): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > cap) throw new Error(`image-mind: response exceeds the ${cap}-byte bound`)
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

/**
 * Read a response body as text, truncated to a character cap (error excerpts only).
 * @param response - the response to drain.
 * @param cap - the character cap.
 * @returns the decoded text, never longer than `cap` characters.
 */
export async function readBoundedText(response: Response, cap: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.length > cap) return text.slice(0, cap)
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return text.length > cap ? text.slice(0, cap) : text
}

export { isImageMimeType, sniffMimeType }
export type { ImageMimeType }
