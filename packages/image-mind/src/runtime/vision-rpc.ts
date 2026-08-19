/**
 * Thin vision-specific Host RPC for the settings card: one real vision call
 * to verify a deployment ("test connection") and one model-list interrogation.
 * Both run through the OpenAI-compatible adapter directly with a draft
 * snapshot the card is still editing — the provider Editor's own
 * responsibility, kept out of the generic vision service. The key never
 * crosses to the browser and every transport guarantee of a normal call still
 * applies. This is transport only: settings persistence lives in the official
 * settings seam.
 * @module dsh-plugin-image-mind/runtime/vision-rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  DEFAULT_API_STYLE, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_TIMEOUT_MS,
  IMAGE_MIND_SETTINGS_NAMESPACE, resolveProvider,
  type ApiStyle, type ResolvedProvider,
} from '../config.ts'
import { VisionError } from '@ran-sh/dsh-vision'
import { OpenAICompatibleVisionAdapter } from '../adapters/openai-compatible/index.ts'
import type { OpenAICompatibleVisionOptions } from '../adapters/openai-compatible/types.ts'
import { resolveApiKey } from '../credentials/resolve.ts'
import { deepFreeze } from '@ran-sh/dsh-vision'
import { discoverEndpointModels, planVisionModels } from '../adapters/openai-compatible/discovery.ts'
import { answerMatches, pickFixture, visualFixture, type FixtureColor } from './visual-fixtures.ts'

/** Redact secrets from any diagnostic text before it crosses to the UI. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret !== undefined && secret.length >= 4) out = out.split(secret).join('[REDACTED]')
  }
  out = out.replace(/(authorization\s*:\s*)bearer\s+[^\s,;]+/gi, '$1[REDACTED]')
  out = out.replace(/(api[_-]?key[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
  return out
}

/** Deployment fields the card may override for one test run (draft values). */
export interface TestConnectionOverrides {
  /** Which provider is being edited; the host overlays its SAVED record. */
  providerId?: string
  baseURL?: string
  model?: string
  /** Only sent when the user edited the field (never the `********` mask). */
  apiKey?: string
  apiKeyEnv?: string
  apiStyle?: 'chat-completions' | 'responses'
  maxOutputTokens?: number
  timeoutMs?: number
  /** Draft-declared keyless fact (host confirms against the endpoint root). */
  keyless?: boolean
  /** Test hook: pin the visual-challenge color (never sent by the card). */
  _fixtureColor?: FixtureColor
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

/** Build the immutable endpoint snapshot one probe holds. */
function snapshotOf(provider: string, spec: ResolvedProvider, timeoutMs: number): OpenAICompatibleVisionOptions {
  return deepFreeze({
    provider,
    baseURL: spec.baseURL,
    model: spec.model,
    apiStyle: spec.apiStyle,
    maxOutputTokens: spec.maxOutputTokens,
    timeoutMs,
    ...spec.apiKey === undefined || spec.apiKey.length === 0 ? {} : { inlineApiKey: spec.apiKey },
    ...spec.apiKeyEnv === undefined || spec.apiKeyEnv.length === 0 ? {} : { apiKeyEnv: String(spec.apiKeyEnv) },
  })
}

/** Read the section's saved connection facts (base URL, model, key seam). */
function savedSection(ctx: Context): Record<string, unknown> {
  const settings = ctx.get('settings')
  if (settings === undefined) return {}
  return (settings.get(IMAGE_MIND_SETTINGS_NAMESPACE) ?? {}) as Record<string, unknown>
}

/**
 * The saved record ONE provider test overlays: when the card names a
 * providerId, the saved fields come from `providers[providerId]` — never the
 * whole section treated as one provider record. Global `timeoutMs` still
 * comes from the section top level.
 */
function savedProviderRecord(ctx: Context, overrides: TestConnectionOverrides): Record<string, unknown> {
  const section = savedSection(ctx)
  const providerId = overrides.providerId?.trim()
  if (providerId === undefined || providerId.length === 0) return section
  const providers = (section['providers'] ?? {}) as Record<string, unknown>
  const record = providers[providerId]
  return {
    ...section,
    ...typeof record === 'object' && record !== null && !Array.isArray(record) ? record as Record<string, unknown> : {},
    timeoutMs: section['timeoutMs'],
  }
}

/** Error text stripped of the plugin prefix for the card. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^image-mind: /, '')
  return String(error)
}

/** The adapter used for draft probes: resolution hooks the card drafts supply. */
function draftAdapter(ctx: Context, options: OpenAICompatibleVisionOptions): OpenAICompatibleVisionAdapter {
  return new OpenAICompatibleVisionAdapter({
    // The draft snapshot is fixed for this probe: never re-resolve from
    // settings while the probe runs.
    resolveProviderOptions: () => options,
    resolveApiKey: snapshot => resolveApiKey(ctx, snapshot),
    retry: { maxRetries: 0 },
  })
}

/**
 * Run one real vision request with the given draft overrides layered over the
 * saved section, and report whether the deployment connects. The request goes
 * out from the host process through the adapter's probe path with a draft
 * snapshot the card is still editing.
 * @param ctx - registrant context.
 * @param overrides - draft field values from the card (may be partial).
 * @returns the model's reply on success, or a readable failure reason.
 */
export async function runConnectionTest(
  ctx: Context,
  overrides: TestConnectionOverrides,
): Promise<
  | { ok: true; text: string; provider: string; model: string; latencyMs: number; visualVerified: true }
  | { ok: false; message: string; visualFailed?: true }
> {
  // The probe overlays the SAVED record of the provider being edited, so a
  // test never mixes provider A's facts into provider B's draft.
  const saved = savedProviderRecord(ctx, overrides)
  let spec: ResolvedProvider
  try {
    spec = draftProvider('test', overrides, saved)
  } catch (error) {
    return { ok: false, message: redactSecrets(messageOf(error), [String(overrides.apiKey ?? '')]) }
  }
  const timeoutMs = Math.max(1, Math.min(Number(overrides.timeoutMs ?? saved.timeoutMs ?? DEFAULT_TIMEOUT_MS), 30_000))
  const options = snapshotOf('test', spec, timeoutMs)
  // One random fixture per probe (or a pinned one in tests): the prompt never
  // names the color, so a text-only model or a broken image path cannot pass
  // by guessing.
  const fixture = overrides._fixtureColor !== undefined
    ? visualFixture(overrides._fixtureColor)
    : pickFixture()
  const started = Date.now()
  try {
    // The draft snapshot carries the throwaway key; the adapter resolves it
    // in-process, the key never crosses to the browser.
    const adapter = draftAdapter(ctx, options)
    const result = await adapter.call('test', {
      prompt: 'Look at the image. Reply with only the COLOR of the visible shape: red, blue, or green.',
      images: [{ bytes: fixture.bytes, mimeType: 'image/png' }],
      signal: AbortSignal.timeout(timeoutMs),
    })
    const latencyMs = Date.now() - started
    if (!answerMatches(result.text, fixture.color)) {
      // The endpoint answered, but the model did not see the image content.
      return {
        ok: false,
        visualFailed: true,
        message: redactSecrets(
          '端点可连接，但视觉验证失败（模型回复 "' + result.text.trim().slice(0, 40) + '"，预期颜色 ' + fixture.color + '）。当前模型可能不支持图片输入。',
          [String(overrides.apiKey ?? '')],
        ),
      }
    }
    return { ok: true, text: fixture.color, provider: 'test', model: spec.model, latencyMs, visualVerified: true }
  } catch (error) {
    return { ok: false, message: redactSecrets(messageOf(error), [String(overrides.apiKey ?? '')]) }
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
  const options = snapshotOf('list', spec, 15_000)
  let apiKey: string
  try {
    apiKey = await resolveApiKey(ctx, options)
  } catch (error) {
    return { ok: true, models: [...plan], source: 'fallback', reason: messageOf(error) }
  }
  try {
    const outcome = await discoverEndpointModels(options, apiKey)
    if (outcome.source === 'endpoint') {
      return { ok: true, models: outcome.models.map(model => model.id), source: 'endpoint' }
    }
    return { ok: true, models: [...plan], source: 'fallback', ...outcome.reason === undefined ? {} : { reason: outcome.reason } }
  } catch (error) {
    return { ok: true, models: [...plan], source: 'fallback', reason: messageOf(error) }
  }
}
