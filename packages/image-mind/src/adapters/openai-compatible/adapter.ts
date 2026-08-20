/**
 * The OpenAI-compatible vision adapter: one instance serves every provider
 * route that speaks chat-completions or responses. The adapter owns its
 * provider facts — it resolves the current endpoint/credential snapshot per
 * call through the constructor hooks, freezes it, and never re-reads live
 * mutable settings while a request is in flight. Retry policy lives here (not
 * in the tool): transient failures (429/5xx/network/timeout) retry with
 * exponential backoff and jitter; auth, config, and response-shape failures
 * never repeat; an aborted signal stops the loop immediately.
 *
 * The vision service routes only `provider → adapter`; everything below this
 * line (endpoint, credential, protocol, HTTP, retry, model discovery) is
 * owned by this package.
 * @module dsh-plugin-image-mind/adapters/openai-compatible/adapter
 */

import { VisionAdapter, VisionError } from '@ran-sh/dsh-vision'
import type { VisionErrorCode } from '@ran-sh/dsh-vision'
import type { VisionModel, VisionModelDiscoveryRequest, VisionRequest, VisionResult } from '@ran-sh/dsh-vision'
import { deepFreeze } from '@ran-sh/dsh-vision'
import type { LoadedImage } from '@ran-sh/dsh-vision'
import { readBoundedBody, readBoundedText } from '../../media/load.ts'
import { buildVisionRequest, extractChatCompletionsContent, extractResponsesContent } from './parse.ts'
import { automaticFallbackVisionModels, discoverEndpointModels } from './discovery.ts'
import { resolveBackoff, sleepBackoff, type BackoffConfig } from './retry.ts'
import type { VisionCache } from '../../cache/vision-cache.ts'
import { globalVisionExecutionGate } from '../../runtime/execution-gate.ts'
import type { OpenAICompatibleVisionOptions } from './types.ts'

/** Default retry count after the first request, matching the harness default. */
const DEFAULT_MAX_RETRIES = 2

/** Constructor options: the operation-local resolution hooks the adapter owns. */
export interface OpenAICompatibleAdapterOptions {
  /**
   * Resolve the current immutable endpoint snapshot for one provider route.
   * Called once per operation; the adapter deep-freezes the result before the
   * wire layer sees it, so an in-flight request never observes a settings
   * change and the next call re-resolves. The request rides along so a model
   * override reaches the wire.
   */
  resolveProviderOptions: (provider: string, request: VisionRequest) => OpenAICompatibleVisionOptions
  /** Resolve the bearer token for one endpoint snapshot. */
  resolveApiKey: (options: Readonly<OpenAICompatibleVisionOptions>) => Promise<string>
  /** Optional semantic cache; absent disables caching. */
  cache?: VisionCache
  /** Retry scheduling; absent uses the default backoff. */
  retry?: { maxRetries?: number; backoff?: BackoffConfig }
}

/** Whether the endpoint error body identifies a text-only model rejection. */
function isTextOnlyModelError(excerpt: string): boolean {
  const e = excerpt.toLowerCase()
  return /allowed values\s*:\s*\[?\s*'text'/.test(e)
    || /content\.type is invalid/.test(e)
    || /(?:image|image_url)\b.*(?:not|doesn't|does not).*(?:support|accept|valid)/.test(e)
    || /(?:not|doesn't|does not).*support.*image/.test(e)
}

/** Whether the endpoint error body identifies an unknown model. */
function isUnknownModelError(excerpt: string): boolean {
  return /unsupported model|model not found|no such model|model .*does not exist|invalid model/i.test(excerpt)
}

/** One-line, actionable hint appended to endpoint errors. */
function responseHint(status: number, retried: boolean, excerpt?: string): string {
  if (excerpt !== undefined) {
    if (isTextOnlyModelError(excerpt)) {
      return '（该模型是纯文本模型，不支持图像输入；请换视觉模型，如 mimo-v2.5、kimi-k3、qwen-vl-max）'
    }
    if (isUnknownModelError(excerpt)) {
      return '（该端点没有这个模型；请检查 model 名称，或点「从端点加载模型」查看可用列表）'
    }
  }
  if (status === 401 || status === 403) return '（请检查 API Key 是否有效，或 apiKeyEnv 指向的凭据是否正确）'
  if (status === 404) return '（请检查 baseURL 是否带版本前缀，例如 https://xxx/v1，不要包含 /chat/completions）'
  if (status === 400) return '（请检查 model 名称在该端点是否存在，以及请求消息格式）'
  if (status === 429) return retried ? '（请求过频：自动重试后仍失败）' : '（请求过频，已自动重试）'
  if (status >= 500) return retried ? '（端点暂时不可用：自动重试后仍失败）' : '（端点暂时不可用，已自动重试）'
  return ''
}

/** The semantic identity of one vision request: a fixed-length SHA-256 of
 * every wire-affecting field plus the ORDERED image digests (never the image
 * bytes themselves — the cache must not hold large image copies). */
export function semanticRequestKey(
  options: Readonly<OpenAICompatibleVisionOptions>,
  prompt: string,
  images: readonly { bytes: Buffer; mimeType: string }[],
): string {
  const canonical = JSON.stringify([
    options.provider, options.baseURL, options.model,
    options.apiStyle, options.maxOutputTokens,
    // Ordered image digests: [A,B] != [B,A].
    images.map(image => [sha256Hex(image.bytes), image.mimeType]),
    prompt,
  ])
  return sha256Hex(Buffer.from(canonical, 'utf8'))
}

/** SHA-256 hex digest of a buffer (node:crypto). */
function sha256Hex(bytes: Buffer): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

/** Re-export for the wire-parsing layer. */
export type { LoadedImage }

/** Classify a non-2xx HTTP status into a stable code. 401/403 are auth failures; 429 is rate-limited; 5xx are provider errors. */
type ProviderWireCode = 'AUTH_FAILED' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'EMPTY_RESPONSE' | 'INVALID_CREDENTIAL' | 'MISSING_CREDENTIAL'

/** Narrow the adapter-owned wire codes into the seam's stable provider-neutral vocabulary. */
function toSeamCode(code: ProviderWireCode): VisionErrorCode {
  switch (code) {
    case 'AUTH_FAILED':
    case 'RATE_LIMITED':
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
    case 'EMPTY_RESPONSE':
    case 'INVALID_RESPONSE':
      return 'PROVIDER_ERROR'
    case 'INVALID_CREDENTIAL':
    case 'MISSING_CREDENTIAL':
      return 'PROVIDER_ERROR'
    default:
      return 'PROVIDER_ERROR'
  }
}

/** Adapter-local wire failure: carries the transport detail the seam must not see. */
/** Upper bound on a provider-requested Retry-After delay (avoid hour-long stalls). */
export const MAX_RETRY_AFTER_MS = 15_000

export class ImageMindVisionError extends Error {
  readonly code: ProviderWireCode
  readonly status?: number
  readonly retryable: boolean
  /** Whether a known-plan alternate model may repair this exact failure. */
  readonly modelFallbackEligible: boolean
  /** Provider-requested delay from a Retry-After header, capped at MAX_RETRY_AFTER_MS. */
  readonly retryAfterMs?: number

  constructor(message: string, code: ProviderWireCode, options?: { status?: number; retryAfterMs?: number; modelFallbackEligible?: boolean; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ImageMindVisionError'
    this.code = code
    this.status = options?.status
    this.retryAfterMs = options?.retryAfterMs
    this.modelFallbackEligible = options?.modelFallbackEligible === true
    // Generic provider/network failures are retryable, but a concrete HTTP
    // 4xx (other than RATE_LIMITED, classified above) is deterministic input,
    // auth, route, or model configuration and must fail fast. Previously every
    // 400/404 was mapped to PROVIDER_ERROR and retried despite the public
    // contract saying 4xx would not repeat.
    this.retryable = code === 'RATE_LIMITED'
      || code === 'TIMEOUT'
      || code === 'NETWORK_ERROR'
      || (code === 'PROVIDER_ERROR' && !(options?.status !== undefined && options.status >= 400 && options.status < 500))
  }
}

/**
 * Parse a Retry-After header: integer seconds, or an HTTP-date. Returns the
 * delay in ms, capped at MAX_RETRY_AFTER_MS; unparseable values yield
 * undefined (fall back to the backoff schedule).
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined
  const trimmed = header.trim()
  if (trimmed.length === 0) return undefined
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isSafeInteger(seconds) || seconds < 0) return undefined
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  }
  const date = Date.parse(trimmed)
  if (!Number.isNaN(date)) {
    const delay = date - Date.now()
    if (delay <= 0) return 0
    return Math.min(delay, MAX_RETRY_AFTER_MS)
  }
  return undefined
}

/** Sleep a fixed delay, abortable (used for Retry-After). */
async function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('image-mind: request aborted during retry delay'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('image-mind: request aborted during retry delay'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Normalize one thrown value into the adapter's wire failure vocabulary. */
function asWireError(error: unknown): ImageMindVisionError {
  if (error instanceof ImageMindVisionError) return error
  if (error instanceof Error && error.name === 'AbortError') return new ImageMindVisionError(error.message, 'NETWORK_ERROR', { cause: error })
  return new ImageMindVisionError((error as Error).message ?? String(error), 'PROVIDER_ERROR', { cause: error })
}

/** Recover the adapter-local cause from the seam wrapper, when present. */
function wireCause(error: unknown): ImageMindVisionError | undefined {
  if (error instanceof ImageMindVisionError) return error
  const cause = (error as { cause?: unknown } | null)?.cause
  return cause instanceof ImageMindVisionError ? cause : undefined
}

/** Strip secret patterns from a provider error excerpt before it reaches a message. */
function redactExcerpt(excerpt: string): string {
  return excerpt
    .replace(/(authorization\s*:\s*)bearer\s+[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/sk-[a-zA-Z0-9]{8,}/g, 'sk-[REDACTED]')
}

/** Classify a non-2xx HTTP status into a stable code. 401/403 are auth failures; 429 is rate-limited; 5xx are provider errors. */
function visionCodeForStatus(status: number): ProviderWireCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED'
  if (status === 429) return 'RATE_LIMITED'
  return 'PROVIDER_ERROR'
}

/**
 * Run one vision request and read back the text answer. Never retries; the
 * caller's retry loop decides.
 */
async function callVisionOnce(
  request: VisionRequest,
  options: Readonly<OpenAICompatibleVisionOptions>,
  apiKey: string,
): Promise<VisionResult> {
  const { path, body } = buildVisionRequest(
    options.baseURL, options.model, options.apiStyle, options.maxOutputTokens,
    request.prompt, request.images,
  )
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body,
      redirect: 'error',
      signal: AbortSignal.any([request.signal ?? new AbortController().signal, AbortSignal.timeout(options.timeoutMs)]),
    })
  } catch (error) {
    // A user cancellation must not be replayed: caller abort propagates
    // as-is and is never retried.
    const callerAborted = request.signal !== undefined && request.signal.aborted
    if (callerAborted) throw error
    // An AbortError WITHOUT a caller abort is our internal timeout signal.
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    throw new ImageMindVisionError(
      isTimeout
        ? `image-mind: vision request timed out after ${options.timeoutMs}ms`
        : `image-mind: vision request failed before a response was received: ${(error as Error).message ?? String(error)}`,
      isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      { cause: error },
    )
  }
  if (!response.ok) {
    const excerpt = await readBoundedText(response, 200)
    const status = response.status
    const code = visionCodeForStatus(status)
    // Providers sometimes echo the request (including the key) in error
    // bodies; strip Authorization/Bearer/api_key patterns before surfacing.
    const safeExcerpt = redactExcerpt(excerpt)
    const modelFallbackEligible = isTextOnlyModelError(safeExcerpt) || isUnknownModelError(safeExcerpt)
    const message = `image-mind: vision endpoint returned HTTP ${status}${safeExcerpt ? `: ${safeExcerpt}` : ''}${responseHint(status, false, safeExcerpt)}`
    throw new ImageMindVisionError(message, code, {
      status,
      modelFallbackEligible,
      retryAfterMs: response.headers !== undefined ? parseRetryAfter(response.headers.get('retry-after')) : undefined,
    })
  }
  const payloadBytes = await readBoundedBody(response, options.maxOutputTokens * 8 + 64 * 1024)
  let payload: unknown
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    throw new ImageMindVisionError('image-mind: vision endpoint returned invalid JSON', 'INVALID_RESPONSE')
  }
  const text = options.apiStyle === 'responses'
    ? extractResponsesContent(payload)
    : extractChatCompletionsContent(payload)
  return { text, provider: options.provider, model: options.model }
}

/**
 * The adapter: run one request with the configured retry policy. The retry
 * supplements a transient failure's message with a note so the caller knows a
 * second attempt was made.
 */
export class OpenAICompatibleVisionAdapter extends VisionAdapter {
  private readonly maxRetries: number
  private readonly backoff: ReturnType<typeof resolveBackoff>

  constructor(private readonly options: OpenAICompatibleAdapterOptions) {
    super()
    this.maxRetries = options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES
    this.backoff = resolveBackoff(options.retry?.backoff)
  }

  /** The immutable endpoint snapshot for one call, deep-frozen before the wire layer sees it. */
  private snapshot(provider: string, request: VisionRequest): OpenAICompatibleVisionOptions {
    return deepFreeze(this.options.resolveProviderOptions(provider, request))
  }

  /**
   * Split a provider-rejected multi-image payload in half and process the
   * chunks sequentially. Recursive callSelectedModel handles a second 413 on
   * either half; a single-image 413 remains a clear terminal provider error.
   */
  private async callSplitImages(
    request: VisionRequest,
    options: Readonly<OpenAICompatibleVisionOptions>,
    apiKey: string,
  ): Promise<VisionResult> {
    const middle = Math.ceil(request.images.length / 2)
    const chunks = [request.images.slice(0, middle), request.images.slice(middle)].filter(chunk => chunk.length > 0)
    const parts: string[] = []
    for (let index = 0; index < chunks.length; index += 1) {
      const result = await this.callSelectedModel({ ...request, images: chunks[index] }, options, apiKey)
      parts.push(`[Vision batch ${index + 1}/${chunks.length}; ${chunks[index].length} image(s)]\n${result.text}`)
    }
    return { text: parts.join('\n\n'), provider: options.provider, model: options.model }
  }

  /** Run one selected model with cache + retry semantics. */
  private async callSelectedModel(
    request: VisionRequest,
    options: Readonly<OpenAICompatibleVisionOptions>,
    apiKey: string,
  ): Promise<VisionResult> {
    const cacheMode = request.cache ?? 'use'
    const cacheKey = this.options.cache === undefined || cacheMode === 'no-store'
      ? undefined
      : semanticRequestKey(options, request.prompt, request.images)
    if (cacheKey !== undefined && cacheMode === 'use') {
      const cached = this.options.cache?.get(cacheKey)
      if (cached !== undefined) {
        return { text: cached, provider: options.provider, model: options.model }
      }
    }

    let attempt = 0
    for (;;) {
      try {
        const result = await globalVisionExecutionGate.run(
          () => callVisionOnce(request, options, apiKey),
          request.signal,
        )
        if (cacheKey !== undefined) this.options.cache?.set(cacheKey, result.text)
        return result
      } catch (error) {
        const wireError = asWireError(error)
        // Payload-too-large is neither a model failure nor a transient retry.
        // For multi-image requests adapt to the provider's real limit by
        // recursively bisecting; keep a single image intact and fail loudly.
        if (wireError.status === 413 && request.images.length > 1) {
          const result = await this.callSplitImages(request, options, apiKey)
          if (cacheKey !== undefined) this.options.cache?.set(cacheKey, result.text)
          return result
        }
        const retryable = wireError.retryable
          || (request.signal?.aborted !== true && error instanceof Error && error.name === 'AbortError')
        if (!retryable || attempt >= this.maxRetries) {
          if (wireError.retryable && attempt > 0 && wireError.status !== undefined) {
            // Rework the message so the model/user sees that a retry already ran.
            const hint = responseHint(wireError.status, true)
            wireError.message = wireError.message.replace(responseHint(wireError.status, false), '') + hint
          }
          // Adapter wire failures cross the seam wrapped in the stable
          // provider-neutral code; the transport detail rides as `cause`.
          throw new VisionError(
            wireError.message,
            toSeamCode(wireError.code),
            { cause: wireError },
          )
        }
        attempt += 1
        try {
          const delay = wireError.retryAfterMs !== undefined
            ? Math.max(this.backoff.initialDelayMs, wireError.retryAfterMs)
            : undefined
          if (delay !== undefined) {
            await sleepFor(delay, request.signal)
          } else {
            await sleepBackoff(attempt - 1, this.backoff, request.signal)
          }
        } catch (abortError) {
          throw abortError
        }
      }
    }
  }

  override async call(provider: string, request: VisionRequest): Promise<VisionResult> {
    // One resolution per call: the endpoint snapshot and its key freeze here
    // and hold for this whole request, so an in-flight request never observes
    // a configuration change and the next call re-resolves.
    const primary = this.snapshot(provider, request)
    const apiKey = await this.options.resolveApiKey(primary)

    try {
      return await this.callSelectedModel(request, primary, apiKey)
    } catch (primaryError) {
      // An explicit model override is an instruction, not a suggestion: never
      // silently substitute another model when the caller selected one.
      if (request.model !== undefined && request.model.trim().length > 0) throw primaryError
      if (wireCause(primaryError)?.modelFallbackEligible !== true) throw primaryError

      const candidates = automaticFallbackVisionModels(primary.baseURL, primary.model)
      let lastError: unknown = primaryError
      for (const model of candidates) {
        const fallback = deepFreeze({ ...primary, model })
        try {
          return await this.callSelectedModel(request, fallback, apiKey)
        } catch (error) {
          lastError = error
          // Only another model-compatibility failure justifies trying the next
          // model. Auth/network/5xx/abort failures describe the endpoint, not
          // this candidate model, so stop immediately instead of multiplying
          // provider traffic.
          if (wireCause(error)?.modelFallbackEligible !== true) throw error
        }
      }
      throw lastError
    }
  }

  override async discoverModels(provider: string, request?: VisionModelDiscoveryRequest): Promise<readonly VisionModel[]> {
    const options = deepFreeze(this.options.resolveProviderOptions(provider, { prompt: '', images: [], signal: request?.signal }))
    const apiKey = await this.options.resolveApiKey(options)
    const outcome = await discoverEndpointModels(options, apiKey, request?.signal)
    return outcome.models
  }
}
