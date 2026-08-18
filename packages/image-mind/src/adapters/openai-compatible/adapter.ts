/**
 * The OpenAI-compatible vision adapter: one instance serves every provider
 * route that speaks chat-completions or responses. The adapter is
 * transport-only — connection facts arrive through an immutable
 * {@link VisionConnection} and the bearer through a resolver. Retry policy
 * lives here (not in the tool): transient failures (429/5xx/network/timeout)
 * retry with exponential backoff and jitter; auth, config, and response-shape
 * failures never repeat; an aborted signal stops the loop immediately.
 * @module dsh-plugin-image-mind/adapters/openai-compatible/adapter
 */

import { VisionAdapter } from '@ran-sh/dsh-vision'
import { VisionError, visionCodeForStatus } from '@ran-sh/dsh-vision'
import type { VisionConnection, VisionModel, VisionRequest, VisionResult } from '@ran-sh/dsh-vision'
import { readBoundedBody, readBoundedText } from '../../media/load.ts'
import { buildVisionRequest, extractChatCompletionsContent, extractResponsesContent } from './parse.ts'
import { discoverEndpointModels } from './discovery.ts'
import { resolveBackoff, sleepBackoff, type BackoffConfig } from './retry.ts'
import type { VisionCache } from '../../cache/vision-cache.ts'

/** Default retry count after the first request, matching the harness default. */
const DEFAULT_MAX_RETRIES = 2

/** Constructor options: the operation-local resolution hooks the adapter needs. */
export interface OpenAICompatibleAdapterOptions {
  /** Resolve the bearer token for one connection snapshot. */
  resolveApiKey: (connection: Readonly<VisionConnection>) => Promise<string>
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
  if (status === 429) return retried ? '（请求过频：已自动重试一次仍失败）' : '（请求过频，已自动重试一次）'
  if (status >= 500) return retried ? '（端点暂时不可用：已自动重试一次仍失败）' : '（端点暂时不可用，已自动重试一次）'
  return ''
}

/** The semantic identity of one vision request: endpoint fields plus the same image bytes and prompt. */
export function semanticRequestKey(connection: Readonly<VisionConnection>, prompt: string, image: { bytes: Buffer; mimeType: string }): string {
  return JSON.stringify([
    connection.provider, connection.baseURL, connection.model,
    connection.apiStyle, connection.maxOutputTokens,
    image.bytes.toString('base64'), image.mimeType, prompt,
  ])
}

/**
 * Run one vision request and read back the text answer. Never retries; the
 * caller's retry loop decides.
 */
async function callVisionOnce(
  request: VisionRequest,
  connection: Readonly<VisionConnection>,
  apiKey: string,
  timeoutMs: number,
): Promise<VisionResult> {
  const { path, body } = buildVisionRequest(
    connection.baseURL, connection.model, connection.apiStyle, connection.maxOutputTokens,
    request.prompt, request.images[0],
  )
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body,
      redirect: 'error',
      signal: AbortSignal.any([request.signal ?? new AbortController().signal, AbortSignal.timeout(timeoutMs)]),
    })
  } catch (error) {
    // A user cancellation must not be replayed; anything else (network
    // failure, our own timeout, protocol error) is transient.
    const callerAborted = request.signal !== undefined && request.signal.aborted
    if (callerAborted || (error instanceof Error && error.name === 'AbortError' && callerAborted)) {
      throw error
    }
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    throw new VisionError(
      isTimeout
        ? `image-mind: vision request timed out after ${timeoutMs}ms`
        : `image-mind: vision request failed before a response was received: ${(error as Error).message ?? String(error)}`,
      isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      { cause: error },
    )
  }
  if (!response.ok) {
    const excerpt = await readBoundedText(response, 200)
    const status = response.status
    const code = visionCodeForStatus(status)
    const message = `image-mind: vision endpoint returned HTTP ${status}${excerpt ? `: ${excerpt}` : ''}${responseHint(status, false, excerpt)}`
    throw new VisionError(message, code, { status })
  }
  const payloadBytes = await readBoundedBody(response, connection.maxOutputTokens * 8 + 64 * 1024)
  let payload: unknown
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    throw new VisionError('image-mind: vision endpoint returned invalid JSON', 'INVALID_RESPONSE')
  }
  const text = connection.apiStyle === 'responses'
    ? extractResponsesContent(payload)
    : extractChatCompletionsContent(payload)
  return { text, provider: connection.provider, model: connection.model }
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

  override async call(request: VisionRequest, connection: Readonly<VisionConnection>): Promise<VisionResult> {
    // One resolution per call: the connection snapshot and its key freeze
    // here and hold for this whole request, so an in-flight request never
    // observes a configuration change and the next call re-resolves.
    const apiKey = await this.options.resolveApiKey(connection)
    const cacheKey = this.options.cache === undefined
      ? undefined
      : semanticRequestKey(connection, request.prompt, request.images[0])
    if (cacheKey !== undefined) {
      const cached = this.options.cache?.get(cacheKey)
      if (cached !== undefined) {
        return { text: cached, provider: connection.provider, model: connection.model }
      }
    }
    let lastError: unknown
    let attempt = 0
    for (;;) {
      try {
        const result = await callVisionOnce(request, connection, apiKey, connection.timeoutMs)
        if (cacheKey !== undefined) this.options.cache?.set(cacheKey, result.text)
        return result
      } catch (error) {
        const visionError = error instanceof VisionError ? error : undefined
        const retryable = visionError?.retryable === true
          || (request.signal?.aborted !== true && error instanceof Error && error.name === 'AbortError' && visionError === undefined)
        if (!retryable || attempt >= this.maxRetries) {
          if (visionError !== undefined && visionError.retryable && attempt > 0 && visionError.status !== undefined) {
            // Rework the message so the model/user sees that a retry already ran.
            const hint = responseHint(visionError.status, true)
            visionError.message = visionError.message.replace(responseHint(visionError.status, false), '') + hint
          }
          throw error
        }
        lastError = error
        attempt += 1
        try {
          await sleepBackoff(attempt - 1, this.backoff, request.signal)
        } catch (abortError) {
          throw abortError
        }
      }
    }
  }

  override async discoverModels(connection: Readonly<VisionConnection>, signal?: AbortSignal): Promise<VisionModel[]> {
    const apiKey = await this.options.resolveApiKey(connection)
    const outcome = await discoverEndpointModels(connection, apiKey, signal)
    return outcome.models
  }
}

export { VisionError }
export type { VisionResult }
