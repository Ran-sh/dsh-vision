/**
 * Vision HTTP client for the image-mind tool: loads one image (local path,
 * http(s) URL, or a stored attachment reference), builds the endpoint request
 * for the configured protocol style (chat-completions or responses), and reads
 * back the single text answer — with a short-lived semantic cache so repeat
 * calls for the same image and prompt avoid a second round trip. Response
 * bodies and error excerpts are capped before any bytes are trusted, and every
 * request refuses redirects so a bearer credential never leaves the
 * configured endpoint.
 * @module dsh-plugin-image-mind/vision
 */

import { readFile, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { attachmentRefById, parseImageAttachmentRef } from './attach.ts'
import { isImageMimeType, sniffMimeType, type ImageMimeType } from './media.ts'
import type { ResolvedProvider } from './config.ts'

/** One loaded image: its bytes and the sniffed media type. */
export interface LoadedImage {
  bytes: Buffer
  mimeType: ImageMimeType
}

/** Promise rejection helper shared by both response-shape extractors. */
function unexpectedShape(): never {
  throw new Error('image-mind: vision endpoint returned an unexpected response shape')
}

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

/** Whether `error` carries the attachment store not-found marker. */
function isAttachmentNotFound(error: unknown): boolean {
  return asRecord(error)?.['code'] === 'ATTACHMENT_NOT_FOUND'
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

/**
 * Load one image from a local absolute path, an http(s) URL, an attachment
 * reference JSON, or a bare attachment id taken out of a markdown image
 * reference, enforcing the byte bound before any bytes reach the vision model.
 * Non-http(s) URL schemes are rejected.
 * @param ctx - registrant context; supplies the optional attachment service.
 * @param input - the model-supplied image reference.
 * @param signal - caller cancellation.
 * @param maxBytes - image byte bound.
 * @returns the loaded bytes and sniffed media type.
 */
export async function loadImage(ctx: Context, input: string, signal: AbortSignal, maxBytes: number): Promise<LoadedImage> {
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
  // A bare attachment id — the `sha256:…` string text models copy out of the
  // markdown image reference instead of the whole JSON. Resolve it through the
  // attach-route registry (the store's digest verification still runs).
  const registered = attachmentRefById(trimmed)
  if (registered !== undefined) {
    const bytes = await readAttachmentRef(ctx, registered, signal)
    assertWithinBound(bytes.length, maxBytes)
    return toImage(bytes, trimmed)
  }
  const info = await stat(trimmed, { bigint: false })
  if (!info.isFile()) throw new Error(`image-mind: image path is not a file: ${trimmed}`)
  assertWithinBound(info.size, maxBytes)
  const bytes = await readFile(trimmed, { signal })
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

/** Extract the single text answer from an OpenAI-compatible chat-completions payload. */
export function extractChatCompletionsContent(payload: unknown): string {
  const root = asRecord(payload)
  const choices = root?.choices
  if (root === undefined || !Array.isArray(choices) || choices.length === 0) unexpectedShape()
  const message = asRecord(asRecord(choices[0])?.message)
  const content = message?.['content']
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('image-mind: vision endpoint returned no text content')
  }
  return content
}

/** Extract the text answer from an OpenAI Responses payload: every `output_text` part of assistant messages. */
export function extractResponsesContent(payload: unknown): string {
  const root = asRecord(payload)
  const output = root?.output
  if (root === undefined || !Array.isArray(output)) unexpectedShape()
  const parts: string[] = []
  for (const item of output) {
    const itemRecord = asRecord(item)
    if (itemRecord === undefined) continue
    const { type, role, content } = itemRecord
    if (type !== 'message' || role !== 'assistant' || !Array.isArray(content)) continue
    for (const part of content) {
      const block = asRecord(part)
      if (block === undefined) continue
      if (block.type === 'output_text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        parts.push(block.text)
      }
    }
  }
  const text = parts.join('\n')
  if (text.trim().length === 0) {
    throw new Error('image-mind: vision endpoint returned no text content')
  }
  return text
}

/** Build the request the configured style sends: its path and JSON body. */
export function buildVisionRequest(spec: ResolvedProvider, prompt: string, image: LoadedImage): { path: string; body: string } {
  const dataUrl = `data:${image.mimeType};base64,${image.bytes.toString('base64')}`
  if (spec.apiStyle === 'responses') {
    return {
      path: `${spec.baseURL}/responses`,
      body: JSON.stringify({
        model: spec.model,
        max_output_tokens: spec.maxOutputTokens,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl },
          ],
        }],
      }),
    }
  }
  return {
    path: `${spec.baseURL}/chat/completions`,
    body: JSON.stringify({
      model: spec.model,
      max_tokens: spec.maxOutputTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
    }),
  }
}

/** Default semantic-cache lifetime for a successful vision answer, in milliseconds. */
export const DEFAULT_CACHE_TTL_MS = 10_000
/** Default upper bound on cached vision answers. */
export const DEFAULT_CACHE_MAX_ENTRIES = 32

/** A bounded, TTL-expiring cache of successful vision answers. */
export interface VisionCache {
  get(key: string): string | undefined
  set(key: string, text: string): void
  readonly size: number
  clear(): void
}

/** Create a TTL-expiring, capacity-capped vision answer cache. */
export function createVisionCache(options?: { ttlMs?: number; maxEntries?: number }): VisionCache {
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS
  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES)
  const entries = new Map<string, { text: string; expiresAt: number }>()
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key)
        return undefined
      }
      return entry.text
    },
    set(key, text) {
      const now = Date.now()
      for (const [k, entry] of entries) if (entry.expiresAt <= now) entries.delete(k)
      entries.set(key, { text, expiresAt: now + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    get size() { return entries.size },
    clear() { entries.clear() },
  }
}

/** The semantic identity of one vision request: endpoint fields plus the same image bytes and prompt. */
function semanticRequestKey(spec: ResolvedProvider, prompt: string, image: LoadedImage): string {
  return JSON.stringify([
    spec.baseURL, spec.model, spec.maxOutputTokens, spec.apiStyle,
    image.bytes.toString('base64'), image.mimeType, prompt,
  ])
}

/**
 * A vision request failure worth retrying once: a transient network/protocol
 * error, a timeout, or an HTTP 429 / 5xx from the endpoint. Configuration
 * faults (4xx) and response-shape errors are never marked transient — a retry
 * would repeat the same mistake.
 */
export class TransientVisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransientVisionError'
  }
}

/**
 * One-line, actionable hint appended to endpoint errors. When an error body is
 * available it is classified first: a "text-only model" rejection and an
 * "unknown model" rejection each get a targeted hint instead of the generic
 * per-status text, because those are the two failures a wrong `model` setting
 * produces and the generic text does not tell them apart.
 */
function responseHint(status: number, retried: boolean, excerpt?: string): string {
  if (excerpt !== undefined) {
    const e = excerpt.toLowerCase()
    const textOnly = /allowed values\s*:\s*\[?\s*'text'/.test(e)
      || /content\.type is invalid/.test(e)
      || /(?:image|image_url)\b.*(?:not|doesn't|does not).*(?:support|accept|valid)/.test(e)
      || /(?:not|doesn't|does not).*support.*image/.test(e)
    if (textOnly) return '（该模型是纯文本模型，不支持图像输入；请换视觉模型，如 mimo-v2.5、kimi-k3、qwen-vl-max）'
    if (/unsupported model|model not found|no such model|model .*does not exist|invalid model/i.test(e)) {
      return '（该端点没有这个模型；请检查 model 名称，或点「从端点加载模型」查看可用列表）'
    }
  }
  if (status === 401 || status === 403) return '（请检查 API Key 是否有效，或 apiKeyEnv 指向的凭据是否正确）'
  if (status === 404) return '（请检查 baseURL 是否带版本前缀，例如 https://xxx/v1，不要包含 /chat/completions）'
  if (status === 400) return '（请检查 model 名称在该端点是否存在，以及请求消息格式）'
  if (status === 429) return retried ? '（请求过频：已自动重试一次仍失败）' : '（请求过频，已自动重试一次）'
  if (status >= 500) return retried ? '（端点暂时不可用：已自动重试一次仍失败）' : '（端点暂时不可用，已自动重试一次）'
  return ''
}

/** Run one vision request and read back the text answer. Never retries. */
async function callVisionOnce(
  spec: ResolvedProvider,
  apiKey: string,
  prompt: string,
  image: LoadedImage,
  signal: AbortSignal,
  timeoutMs: number,
  cache?: VisionCache,
): Promise<string> {
  const { path, body } = buildVisionRequest(spec, prompt, image)
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
  } catch (error) {
    // A user cancellation must not be replayed; anything else (network
    // failure, our own timeout, protocol error) is transient.
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError' && signal.aborted)) {
      throw error
    }
    throw new TransientVisionError(`image-mind: vision request failed before a response was received: ${(error as Error).message ?? String(error)}`)
  }
  if (!response.ok) {
    const excerpt = await readBoundedText(response, 200)
    const message = `image-mind: vision endpoint returned HTTP ${response.status}${excerpt ? `: ${excerpt}` : ''}${responseHint(response.status, false, excerpt)}`
    if (response.status === 429 || response.status >= 500) throw new TransientVisionError(message)
    throw new Error(message)
  }
  const payloadBytes = await readBoundedBody(response, spec.maxOutputTokens * 8 + 64 * 1024)
  let payload: unknown
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    throw new Error('image-mind: vision endpoint returned invalid JSON')
  }
  const text = spec.apiStyle === 'responses' ? extractResponsesContent(payload) : extractChatCompletionsContent(payload)
  if (cache !== undefined) cache.set(semanticRequestKey(spec, prompt, image), text)
  return text
}

/**
 * Call the configured vision endpoint and return its text answer, with
 * short-lifetime caching for repeats, and one automatic retry for transient
 * failures (network/timeout/429/5xx). The retry supplements the existing
 * message with a note so the caller knows a second attempt was made.
 * @param spec - validated configuration.
 * @param apiKey - resolved bearer credential.
 * @param prompt - the caller's instruction.
 * @param image - the loaded image.
 * @param signal - caller cancellation.
 * @param cache - optional semantic cache.
 * @returns the vision model's text answer.
 */
export async function callVision(
  spec: ResolvedProvider,
  apiKey: string,
  prompt: string,
  image: LoadedImage,
  signal: AbortSignal,
  timeoutMs: number,
  cache?: VisionCache,
): Promise<string> {
  if (cache !== undefined) {
    const cached = cache.get(semanticRequestKey(spec, prompt, image))
    if (cached !== undefined) return cached
  }
  try {
    return await callVisionOnce(spec, apiKey, prompt, image, signal, timeoutMs, cache)
  } catch (error) {
    if (!(error instanceof TransientVisionError)) throw error
    try {
      return await callVisionOnce(spec, apiKey, prompt, image, signal, timeoutMs, cache)
    } catch (retryError) {
      if (retryError instanceof TransientVisionError) {
        // Rework the message so the model/user sees that a retry already ran.
        const detail = /vision endpoint returned HTTP (\d+)/.exec(retryError.message)
        if (detail !== null) {
          const status = Number(detail[1])
          const message = retryError.message.replace(responseHint(status, false), '')
          throw new Error(`${message}${responseHint(status, true)}`)
        }
      }
      throw retryError
    }
  }
}
