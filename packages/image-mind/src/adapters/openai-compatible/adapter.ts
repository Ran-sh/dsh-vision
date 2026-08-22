/**
 * OpenAI-compatible vision adapter: endpoint resolution, cache, retries,
 * adaptive payload splitting, bounded model/provider fallback, and
 * provider-neutral execution tracing.
 */

import { VisionAdapter, VisionError, deepFreeze } from '@ran-sh/dsh-vision'
import type {
  LoadedImage, VisionErrorCode, VisionModel, VisionModelDiscoveryRequest,
  VisionRequest, VisionResult, VisionTrace,
} from '@ran-sh/dsh-vision'
import { readBoundedBody, readBoundedText } from '../../media/load.ts'
import {
  buildVisionRequest,
  extractChatCompletionsContent,
  extractResponsesContent,
  extractVisionUsage,
} from './parse.ts'
import { automaticFallbackVisionModels, discoverEndpointModels } from './discovery.ts'
import { resolveBackoff, sleepBackoff, type BackoffConfig } from './retry.ts'
import type { VisionCache } from '../../cache/vision-cache.ts'
import { globalVisionExecutionGate } from '../../runtime/execution-gate.ts'
import type { OpenAICompatibleVisionOptions } from './types.ts'

const DEFAULT_MAX_RETRIES = 2
const MAX_PROVIDER_FALLBACKS = 2

export interface ProviderFallbackCandidate {
  provider: string
  /** `no-store` is reserved for fresh recovery probes that must hit the wire. */
  cache?: 'no-store'
}

/** Provider-route outcome after retry/model-fallback work for that route. */
export interface ProviderAttemptEvent {
  provider: string
  providerCalls: number
  cacheHits: number
  elapsedMs: number
  aborted: boolean
  error?: unknown
}

export interface OpenAICompatibleAdapterOptions {
  resolveProviderOptions: (provider: string, request: VisionRequest) => OpenAICompatibleVisionOptions
  resolveApiKey: (options: Readonly<OpenAICompatibleVisionOptions>) => Promise<string>
  resolveProviderFallbacks?: (
    provider: string,
    request: VisionRequest,
  ) => readonly (string | ProviderFallbackCandidate)[]
  onProviderAttempt?: (event: ProviderAttemptEvent) => void
  cache?: VisionCache
  retry?: { maxRetries?: number; backoff?: BackoffConfig }
}

function createTrace(): VisionTrace {
  return {
    providerCalls: 0,
    payloadBytes: 0,
    cacheHits: 0,
    retries: 0,
    modelFallbacks: 0,
    providerFallbacks: 0,
    splits: 0,
  }
}

function snapshotTrace(trace: VisionTrace): VisionTrace {
  return { ...trace }
}

function withTrace(result: VisionResult, trace: VisionTrace): VisionResult {
  return { ...result, trace: snapshotTrace(trace) }
}

function isTextOnlyModelError(excerpt: string): boolean {
  const e = excerpt.toLowerCase()
  return /allowed values\s*:\s*\[?\s*'text'/.test(e)
    || /content\.type is invalid/.test(e)
    || /(?:image|image_url)\b.*(?:not|doesn't|does not).*(?:support|accept|valid)/.test(e)
    || /(?:not|doesn't|does not).*support.*image/.test(e)
}

function isUnknownModelError(excerpt: string): boolean {
  return /unsupported model|model not found|no such model|model .*does not exist|invalid model/i.test(excerpt)
}

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

function defaultImageOrdinals(imageCount: number): number[] {
  return Array.from({ length: imageCount }, (_, index) => index + 1)
}

export function semanticRequestKey(
  options: Readonly<OpenAICompatibleVisionOptions>,
  prompt: string,
  images: readonly { bytes: Buffer; mimeType: string }[],
  imageOrdinals: readonly number[] = defaultImageOrdinals(images.length),
  originalImageCount: number = images.length,
): string {
  const canonical = JSON.stringify([
    options.provider, options.baseURL, options.model,
    options.apiStyle, options.maxOutputTokens,
    images.map(image => [sha256Hex(image.bytes), image.mimeType]),
    prompt,
    imageOrdinals,
    originalImageCount,
  ])
  return sha256Hex(Buffer.from(canonical, 'utf8'))
}

function sha256Hex(bytes: Buffer): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

export type { LoadedImage }

type ProviderWireCode =
  | 'AUTH_FAILED' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'TIMEOUT'
  | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'EMPTY_RESPONSE'
  | 'INVALID_CREDENTIAL' | 'MISSING_CREDENTIAL'

function toSeamCode(_code: ProviderWireCode): VisionErrorCode {
  return 'PROVIDER_ERROR'
}

export const MAX_RETRY_AFTER_MS = 15_000

export class ImageMindVisionError extends Error {
  readonly code: ProviderWireCode
  readonly status?: number
  readonly retryable: boolean
  readonly modelFallbackEligible: boolean
  readonly retryAfterMs?: number

  constructor(message: string, code: ProviderWireCode, options?: { status?: number; retryAfterMs?: number; modelFallbackEligible?: boolean; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ImageMindVisionError'
    this.code = code
    this.status = options?.status
    this.retryAfterMs = options?.retryAfterMs
    this.modelFallbackEligible = options?.modelFallbackEligible === true
    this.retryable = code === 'RATE_LIMITED'
      || code === 'TIMEOUT'
      || code === 'NETWORK_ERROR'
      || (code === 'PROVIDER_ERROR' && !(options?.status !== undefined && options.status >= 400 && options.status < 500))
  }
}

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

async function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('image-mind: request aborted during retry delay'))
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      cleanup()
      reject(signal?.reason instanceof Error ? signal.reason : new Error('image-mind: request aborted during retry delay'))
    }
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function asWireError(error: unknown): ImageMindVisionError {
  if (error instanceof ImageMindVisionError) return error
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ImageMindVisionError(error.message, error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', { cause: error })
  }
  return new ImageMindVisionError((error as Error).message ?? String(error), 'PROVIDER_ERROR', { cause: error })
}

function wireCause(error: unknown): ImageMindVisionError | undefined {
  if (error instanceof ImageMindVisionError) return error
  const cause = (error as { cause?: unknown } | null)?.cause
  return cause instanceof ImageMindVisionError ? cause : undefined
}

function providerFallbackEligible(error: unknown): boolean {
  const wire = wireCause(error)
  if (wire === undefined || wire.modelFallbackEligible) return false
  if (wire.code === 'RATE_LIMITED' || wire.code === 'TIMEOUT' || wire.code === 'NETWORK_ERROR') return true
  if (wire.code !== 'PROVIDER_ERROR') return false
  return wire.status === 413 || (wire.status !== undefined && wire.status >= 500)
}

function redactExcerpt(excerpt: string): string {
  return excerpt
    .replace(/(authorization\s*:\s*)bearer\s+[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/sk-[a-zA-Z0-9]{8,}/g, 'sk-[REDACTED]')
}

function visionCodeForStatus(status: number): ProviderWireCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED'
  if (status === 429) return 'RATE_LIMITED'
  return 'PROVIDER_ERROR'
}

async function callVisionOnce(
  request: VisionRequest,
  options: Readonly<OpenAICompatibleVisionOptions>,
  apiKey: string,
  imageOrdinals: readonly number[],
  originalImageCount: number,
  trace: VisionTrace,
): Promise<VisionResult> {
  const { path, body } = buildVisionRequest(
    options.baseURL, options.model, options.apiStyle, options.maxOutputTokens,
    request.prompt, request.images, imageOrdinals, originalImageCount,
  )
  trace.providerCalls += 1
  trace.payloadBytes += Buffer.byteLength(body, 'utf8')

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
    if (request.signal !== undefined && request.signal.aborted) throw error
    const name = error instanceof Error ? error.name : ''
    const isTimeout = name === 'AbortError' || name === 'TimeoutError'
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
  const usage = extractVisionUsage(payload, options.apiStyle)
  return {
    text,
    provider: options.provider,
    model: options.model,
    ...usage === undefined ? {} : { usage },
  }
}

export class OpenAICompatibleVisionAdapter extends VisionAdapter {
  private readonly maxRetries: number
  private readonly backoff: ReturnType<typeof resolveBackoff>

  constructor(private readonly options: OpenAICompatibleAdapterOptions) {
    super()
    this.maxRetries = options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES
    this.backoff = resolveBackoff(options.retry?.backoff)
  }

  private snapshot(provider: string, request: VisionRequest): OpenAICompatibleVisionOptions {
    return deepFreeze(this.options.resolveProviderOptions(provider, request))
  }

  private async callSplitImages(
    request: VisionRequest,
    options: Readonly<OpenAICompatibleVisionOptions>,
    apiKey: string,
    trace: VisionTrace,
    imageOrdinals: readonly number[],
    originalImageCount: number,
  ): Promise<VisionResult> {
    const middle = Math.ceil(request.images.length / 2)
    const chunks = [request.images.slice(0, middle), request.images.slice(middle)].filter(chunk => chunk.length > 0)
    const ordinalChunks = [imageOrdinals.slice(0, middle), imageOrdinals.slice(middle)].filter(chunk => chunk.length > 0)
    const parts: string[] = []
    let inputTokens = 0
    let outputTokens = 0
    let sawInputTokens = false
    let sawOutputTokens = false
    for (let index = 0; index < chunks.length; index += 1) {
      const ordinals = ordinalChunks[index]
      const result = await this.callSelectedModel(
        { ...request, images: chunks[index] }, options, apiKey, trace, ordinals, originalImageCount,
      )
      const labels = ordinals.map(value => `Image ${value}`).join(', ')
      parts.push(`[Vision split evidence for original ${labels} of ${originalImageCount}]\n${result.text}`)
      if (result.usage?.inputTokens !== undefined) {
        sawInputTokens = true
        inputTokens += result.usage.inputTokens
      }
      if (result.usage?.outputTokens !== undefined) {
        sawOutputTokens = true
        outputTokens += result.usage.outputTokens
      }
    }
    const usage = !sawInputTokens && !sawOutputTokens ? undefined : {
      ...sawInputTokens ? { inputTokens } : {},
      ...sawOutputTokens ? { outputTokens } : {},
    }
    return {
      text: parts.join('\n\n'),
      provider: options.provider,
      model: options.model,
      ...usage === undefined ? {} : { usage },
    }
  }

  private async callSelectedModel(
    request: VisionRequest,
    options: Readonly<OpenAICompatibleVisionOptions>,
    apiKey: string,
    trace: VisionTrace,
    imageOrdinals: readonly number[] = defaultImageOrdinals(request.images.length),
    originalImageCount: number = request.images.length,
  ): Promise<VisionResult> {
    const cacheMode = request.cache ?? 'use'
    const cacheKey = this.options.cache === undefined || cacheMode === 'no-store'
      ? undefined
      : semanticRequestKey(options, request.prompt, request.images, imageOrdinals, originalImageCount)
    if (cacheKey !== undefined && cacheMode === 'use') {
      const cached = this.options.cache?.get(cacheKey)
      if (cached !== undefined) {
        trace.cacheHits += 1
        return { text: cached, provider: options.provider, model: options.model }
      }
    }

    let attempt = 0
    for (;;) {
      try {
        const result = await globalVisionExecutionGate.run(
          () => callVisionOnce(request, options, apiKey, imageOrdinals, originalImageCount, trace),
          request.signal,
        )
        if (cacheKey !== undefined) this.options.cache?.set(cacheKey, result.text)
        return result
      } catch (error) {
        if (request.signal?.aborted === true) {
          throw request.signal.reason instanceof Error ? request.signal.reason : error
        }
        const wireError = asWireError(error)
        if (wireError.status === 413 && request.images.length > 1) {
          trace.splits += 1
          const result = await this.callSplitImages(request, options, apiKey, trace, imageOrdinals, originalImageCount)
          if (cacheKey !== undefined) this.options.cache?.set(cacheKey, result.text)
          return result
        }
        const retryable = wireError.retryable || (error instanceof Error && error.name === 'AbortError')
        if (!retryable || attempt >= this.maxRetries) {
          if (wireError.retryable && attempt > 0 && wireError.status !== undefined) {
            const hint = responseHint(wireError.status, true)
            wireError.message = wireError.message.replace(responseHint(wireError.status, false), '') + hint
          }
          throw new VisionError(wireError.message, toSeamCode(wireError.code), { cause: wireError, trace })
        }
        attempt += 1
        trace.retries += 1
        const delay = wireError.retryAfterMs !== undefined
          ? Math.max(this.backoff.initialDelayMs, wireError.retryAfterMs)
          : undefined
        if (delay !== undefined) await sleepFor(delay, request.signal)
        else await sleepBackoff(attempt - 1, this.backoff, request.signal)
      }
    }
  }

  private async callProvider(provider: string, request: VisionRequest, trace: VisionTrace): Promise<VisionResult> {
    const primary = this.snapshot(provider, request)
    const apiKey = await this.options.resolveApiKey(primary)
    try {
      return await this.callSelectedModel(request, primary, apiKey, trace)
    } catch (primaryError) {
      if (request.model !== undefined && request.model.trim().length > 0) throw primaryError
      if (wireCause(primaryError)?.modelFallbackEligible !== true) throw primaryError

      const candidates = automaticFallbackVisionModels(primary.baseURL, primary.model)
      let lastError: unknown = primaryError
      for (const model of candidates) {
        trace.modelFallbacks += 1
        const fallback = deepFreeze({ ...primary, model })
        try {
          return await this.callSelectedModel(request, fallback, apiKey, trace)
        } catch (error) {
          lastError = error
          if (wireCause(error)?.modelFallbackEligible !== true) throw error
        }
      }
      throw lastError
    }
  }

  private async callProviderObserved(provider: string, request: VisionRequest, trace: VisionTrace): Promise<VisionResult> {
    const started = Date.now()
    const providerCallsBefore = trace.providerCalls
    const cacheHitsBefore = trace.cacheHits
    try {
      const result = await this.callProvider(provider, request, trace)
      this.options.onProviderAttempt?.({
        provider,
        providerCalls: trace.providerCalls - providerCallsBefore,
        cacheHits: trace.cacheHits - cacheHitsBefore,
        elapsedMs: Date.now() - started,
        aborted: request.signal?.aborted === true,
      })
      return result
    } catch (error) {
      this.options.onProviderAttempt?.({
        provider,
        providerCalls: trace.providerCalls - providerCallsBefore,
        cacheHits: trace.cacheHits - cacheHitsBefore,
        elapsedMs: Date.now() - started,
        aborted: request.signal?.aborted === true,
        error,
      })
      throw error
    }
  }

  override async call(provider: string, request: VisionRequest): Promise<VisionResult> {
    const trace = createTrace()
    try {
      return withTrace(await this.callProviderObserved(provider, request, trace), trace)
    } catch (primaryError) {
      if (request.provider !== undefined && request.provider.trim().length > 0) throw primaryError
      if (request.model !== undefined && request.model.trim().length > 0) throw primaryError
      if (!providerFallbackEligible(primaryError)) throw primaryError

      const planned = this.options.resolveProviderFallbacks?.(provider, request) ?? []
      const seen = new Set([provider])
      const candidates: ProviderFallbackCandidate[] = []
      for (const raw of planned) {
        const plan: ProviderFallbackCandidate = typeof raw === 'string' ? { provider: raw } : raw
        const candidate = plan.provider.trim()
        if (candidate.length === 0 || seen.has(candidate)) continue
        seen.add(candidate)
        candidates.push({ provider: candidate, ...(plan.cache === 'no-store' ? { cache: 'no-store' } : {}) })
        if (candidates.length >= MAX_PROVIDER_FALLBACKS) break
      }

      let lastError: unknown = primaryError
      for (const candidate of candidates) {
        trace.providerFallbacks += 1
        const fallbackRequest = candidate.cache === 'no-store'
          ? { ...request, cache: 'no-store' as const }
          : request
        try {
          return withTrace(await this.callProviderObserved(candidate.provider, fallbackRequest, trace), trace)
        } catch (error) {
          lastError = error
          if (!providerFallbackEligible(error)) throw error
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
