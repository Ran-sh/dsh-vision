/**
 * Thin vision-specific Host RPC for the settings card: one real vision call
 * to verify a deployment ("test connection") and one model-list interrogation.
 * Both resolve the draft over the saved section and run through the vision
 * runtime, so the key never crosses to the browser and every transport
 * guarantee of a normal call still applies. This is transport only — settings
 * persistence lives in the official settings seam.
 * @module dsh-plugin-image-mind/runtime/vision-rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  DEFAULT_API_STYLE, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_TIMEOUT_MS,
  IMAGE_MIND_SETTINGS_NAMESPACE, isKeylessEndpoint, resolveProvider,
  type ApiStyle, type ResolvedProvider,
} from '../config.ts'
import { VisionError, isVisionError } from '../runtime/errors.ts'
import type { VisionConnection, VisionDraftConnection } from '../runtime/types.ts'
import { resolveApiKey } from '../credentials/resolve.ts'
import { discoverEndpointModels, planVisionModels } from '../adapters/openai-compatible/discovery.ts'
import { createVisionCache } from '../cache/vision-cache.ts'

/** A tiny embedded 1x1 red PNG (69 bytes) used as the probe image. */
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

/** Deployment fields the card may override for one test run (draft values). */
export interface TestConnectionOverrides {
  baseURL?: string
  model?: string
  /** Only sent when the user edited the field (never the `********` mask). */
  apiKey?: string
  apiKeyEnv?: string
  apiStyle?: 'chat-completions' | 'responses'
  maxOutputTokens?: number
  timeoutMs?: number
}

/** The mask value the browser shows for a configured key; an untouched field never travels. */
const API_KEY_MASK_RE = /^\*+$/

/** Build a draft ResolvedProvider from loose overrides, validated by resolveProvider. */
export function draftProvider(id: string, overrides: TestConnectionOverrides, saved: Record<string, unknown>): ResolvedProvider {
  const baseURL = String(overrides.baseURL ?? saved.baseURL ?? '').trim().replace(/\/+$/, '')
  const model = String(overrides.model ?? saved.model ?? '').trim()
  if (baseURL.length === 0 || model.length === 0) {
    throw new VisionError('image-mind: 请先填写视觉端点地址（baseURL）和模型（model）', 'PROVIDER_NOT_FOUND')
  }
  const apiStyle = (overrides.apiStyle ?? saved.apiStyle ?? DEFAULT_API_STYLE) as ApiStyle
  const maxOutputTokens = Number(overrides.maxOutputTokens ?? saved.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS)
  const spec = resolveProvider(id, {
    baseURL, model, apiStyle, maxOutputTokens,
    apiKey: undefined, apiKeyEnv: undefined,
  })
  // Key resolution for this one probe: an edited draft key wins; otherwise the
  // saved inline key (host-process only) or the env seam as drafted/saved.
  // An empty env seam means "no key needed" (localhost endpoints resolve as
  // keyless in resolveApiKey), so it is NOT replaced by the default.
  const editedKey = overrides.apiKey !== undefined && !API_KEY_MASK_RE.test(overrides.apiKey) ? overrides.apiKey : undefined
  if (editedKey !== undefined) {
    spec.apiKey = editedKey
  } else if (typeof saved.apiKey === 'string' && saved.apiKey.length > 0) {
    spec.apiKey = saved.apiKey
  } else {
    const envName = String(overrides.apiKeyEnv ?? saved.apiKeyEnv ?? '').trim()
    if (envName.length > 0) spec.apiKeyEnv = credentialRef(envName)
  }
  return spec
}

/**
 * Build a draft ResolvedProvider for listing models: only the endpoint root is
 * required — `/models` needs the baseURL and a key, never a model id.
 */
export function draftProviderForListing(id: string, overrides: TestConnectionOverrides, saved: Record<string, unknown>): ResolvedProvider {
  const baseURL = String(overrides.baseURL ?? saved.baseURL ?? '').trim().replace(/\/+$/, '')
  if (baseURL.length === 0) {
    throw new VisionError('image-mind: 请先填写视觉端点地址（baseURL）', 'PROVIDER_NOT_FOUND')
  }
  const spec = resolveProvider(id, {
    baseURL,
    model: String(overrides.model ?? saved.model ?? '').trim() || 'placeholder',
    apiStyle: (overrides.apiStyle ?? saved.apiStyle ?? DEFAULT_API_STYLE) as ApiStyle,
    maxOutputTokens: Number(overrides.maxOutputTokens ?? saved.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
    apiKey: undefined, apiKeyEnv: undefined,
  })
  const editedKey = overrides.apiKey !== undefined && !API_KEY_MASK_RE.test(overrides.apiKey) ? overrides.apiKey : undefined
  if (editedKey !== undefined) {
    spec.apiKey = editedKey
  } else if (typeof saved.apiKey === 'string' && saved.apiKey.length > 0) {
    spec.apiKey = saved.apiKey
  } else {
    const envName = String(overrides.apiKeyEnv ?? saved.apiKeyEnv ?? '').trim()
    if (envName.length > 0) spec.apiKeyEnv = credentialRef(envName)
  }
  return spec
}

/** Build a VisionConnection from a resolved provider draft. */
function connectionOf(provider: string, spec: ResolvedProvider, timeoutMs: number): VisionConnection {
  return {
    provider,
    baseURL: spec.baseURL,
    model: spec.model,
    apiStyle: spec.apiStyle,
    maxOutputTokens: spec.maxOutputTokens,
    timeoutMs,
    ...spec.apiKeyEnv === undefined || spec.apiKeyEnv.length === 0 ? {} : { apiKeyEnv: String(spec.apiKeyEnv) },
  }
}

/** Read the section's saved connection facts (base URL, model, key seam). */
function savedSection(ctx: Context): Record<string, unknown> {
  const settings = ctx.get('settings')
  if (settings === undefined) return {}
  return (settings.get(IMAGE_MIND_SETTINGS_NAMESPACE) ?? {}) as Record<string, unknown>
}

/** Error text stripped of the plugin prefix for the card. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^image-mind: /, '')
  return String(error)
}

/**
 * Run one real vision request with the given draft overrides layered over the
 * saved section, and report whether the deployment connects. The request
 * goes out from the host process through the adapter's normal transport.
 * @param ctx - registrant context.
 * @param overrides - draft field values from the card (may be partial).
 * @returns the model's reply on success, or a readable failure reason.
 */
export async function runConnectionTest(ctx: Context, overrides: TestConnectionOverrides): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const saved = savedSection(ctx)
  let spec: ResolvedProvider
  try {
    spec = draftProvider('test', overrides, saved)
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
  const timeoutMs = Math.max(1, Math.min(Number(overrides.timeoutMs ?? saved.timeoutMs ?? DEFAULT_TIMEOUT_MS), 30_000))
  const connection = connectionOf('test', spec, timeoutMs)
  const vision = ctx.get('vision')
  if (vision === undefined) {
    return { ok: false, message: 'vision runtime is not mounted' }
  }
  try {
    // Run the probe through the runtime's registered adapter, with a
    // throwaway cache so repeats in the same session still probe fresh.
    const result = await vision.call({
      provider: 'test',
      prompt: 'Reply with exactly one short word: OK',
      images: [{ bytes: Buffer.from(TEST_IMAGE_BASE64, 'base64'), mimeType: 'image/png' }],
      signal: AbortSignal.timeout(timeoutMs),
    }, { ...connection, timeoutMs })
    return { ok: true, text: result.text.trim() }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

/**
 * List model ids an OpenAI-compatible endpoint advertises through GET
 * /v1/models. Never errors out: when the endpoint lacks the route, rejects
 * the key, or answers in a non-OpenAI shape, the caller still gets a fallback
 * list so the picker stays usable. The key travels from the host process only.
 * @param ctx - registrant context.
 * @param overrides - draft field values from the card (may be partial).
 * @returns endpoint model ids plus a stable fallback, and a reason when the
 *   endpoint list could not be read.
 */
export async function listEndpointModels(ctx: Context, overrides: TestConnectionOverrides): Promise<{ ok: true; models: string[]; source: 'endpoint' | 'fallback'; reason?: string } | { ok: false; message: string }> {
  const saved = savedSection(ctx)
  let spec: ResolvedProvider
  try {
    spec = draftProviderForListing('list', overrides, saved)
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
  const { baseURL } = spec
  const plan = planVisionModels(baseURL)
  const connection = connectionOf('list', spec, 15_000)
  let apiKey: string
  try {
    apiKey = await resolveApiKey(ctx, connection)
  } catch (error) {
    return { ok: true, models: [...plan], source: 'fallback', reason: messageOf(error) }
  }
  try {
    const outcome = await discoverEndpointModels(connection, apiKey)
    if (outcome.source === 'endpoint') {
      return { ok: true, models: outcome.models.map(model => model.id), source: 'endpoint' }
    }
    return { ok: true, models: [...plan], source: 'fallback', ...outcome.reason === undefined ? {} : { reason: outcome.reason } }
  } catch (error) {
    return { ok: true, models: [...plan], source: 'fallback', reason: messageOf(error) }
  }
}

export { VisionError, isVisionError, createVisionCache, isKeylessEndpoint }
