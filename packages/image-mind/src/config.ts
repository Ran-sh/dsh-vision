/**
 * Config and credential facts for the image-mind tool: the validated
 * ResolvedConfig snapshot, the API-key resolution seams, and the schemastery
 * section that doubles as the plugin's settings schema. The section models
 * several named vision providers (like the built-in Models page) plus one
 * active provider, so the settings card can render per-provider cards with
 * their own endpoint/model/key and a "set as active" control.
 *
 * The resolved snapshot is the single explicit resolve step: every default
 * and bound is re-judged here, and the runtime captures an immutable
 * connection snapshot per call from it, so an in-flight request never
 * observes a settings change and the next call re-resolves.
 * @module dsh-plugin-image-mind/config
 */

import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Environment-variable name the API key resolves through when no inline key is configured. */
export const DEFAULT_API_KEY_ENV = 'VISION_API_KEY'
/**
 * Provider-side output-token hard cap. Keep the default at least as large as
 * the largest task policy (OCR/document = 3000) so task-aware budgets are not
 * silently flattened to the historical 1024-token default. Explicit user
 * configuration remains authoritative and may intentionally lower this cap.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 3000
/** Per-call vision request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 60_000
/** Protocol styles the tool can speak to the configured endpoint. */
export const API_STYLES = ['chat-completions', 'responses'] as const
export type ApiStyle = typeof API_STYLES[number]
/** Protocol style used unless the configuration overrides it. */
export const DEFAULT_API_STYLE: ApiStyle = 'chat-completions'
/** Whether conversation image references upgrade into inline thumbnails unless configured otherwise. */
export const DEFAULT_RENDER_IMAGE_PREVIEW = true
/** Whether fetching image URLs on private networks is allowed (SSRF guard). */
export const DEFAULT_ALLOW_PRIVATE_NETWORK = false
/** Instruction sent when the model does not pass its own prompt. */
export const DEFAULT_PROMPT =
  'Analyze this image: describe what is visible factually, transcribe legible text verbatim, and call out layout, notable details, or anything anomalous. Answer in Chinese unless the caller asks otherwise.'

/** One named vision provider: a self-contained endpoint + model + key reference. */
export interface Provider {
  /** OpenAI-compatible endpoint root, e.g. `https://api.openai.com/v1`; trailing slashes stripped. */
  baseURL: string
  /** Vision model id on that endpoint. */
  model: string
  /**
   * Inline API key. DEPRECATED: prefer `apiKeyEnv` with the credential seam;
   * the UI no longer creates inline keys and the value never leaves the host.
   * Kept for backward compatibility with existing settings documents.
   */
  apiKey?: string
  /** Credential reference (environment-variable name) for the API key; defaults to `VISION_API_KEY`. */
  apiKeyEnv?: string
  /** Protocol style of the endpoint; defaults to `chat-completions`. */
  apiStyle?: ApiStyle
  /** Output-token cap sent to the vision model. */
  maxOutputTokens?: number
}

/**
 * Deployment configuration for the image-mind tool. The `providers` map holds
 * every configured vision provider keyed by a short id; `active` names which
 * one the tool uses by default. An unconfigured mount still loads — the first
 * call fails with a clear "no active provider" message instead.
 */
export interface Config {
  /** Named vision providers. */
  providers?: Record<string, Provider>
  /** The provider id the tool uses unless a call names another. */
  active?: string
  /** Instruction used when a call omits its `prompt`. */
  defaultPrompt?: string
  /** Image byte bound; defaults to 10 MiB. */
  maxBytes?: number
  /** Per-call request timeout in milliseconds. */
  timeoutMs?: number
  /** Whether image-mind references upgrade into inline thumbnails. Display-only. */
  renderImagePreview?: boolean
  /** Whether fetching image URLs on private networks is allowed. Defaults to false (SSRF guard). */
  allowPrivateNetwork?: boolean
}

/** Schemastery configuration for the image-mind tool; doubles as the settings-section schema. */
export const Config: z<Config> = z.object({
  providers: z.dict(z.object({
    baseURL: z.string(),
    model: z.string(),
    apiKey: z.string().role('secret'),
    apiKeyEnv: z.string().role('credential-ref'),
    apiStyle: z.union(API_STYLES).default(DEFAULT_API_STYLE),
    maxOutputTokens: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_TOKENS),
  })),
  active: z.string(),
  defaultPrompt: z.string().default(DEFAULT_PROMPT),
  maxBytes: z.number().step(1).min(1).default(10 * 1024 * 1024),
  timeoutMs: z.number().min(1).default(DEFAULT_TIMEOUT_MS),
  renderImagePreview: z.boolean().default(DEFAULT_RENDER_IMAGE_PREVIEW),
  allowPrivateNetwork: z.boolean().default(DEFAULT_ALLOW_PRIVATE_NETWORK),
})

/** Settings namespace the web GUI's plugin-config card edits. */
export const IMAGE_MIND_SETTINGS_NAMESPACE = settingsNamespace('image-mind')

/** One resolved, validated provider snapshot. */
export interface ResolvedProvider {
  baseURL: string
  model: string
  apiKey: string | undefined
  apiKeyEnv: CredentialRef | undefined
  apiStyle: ApiStyle
  maxOutputTokens: number
}

/** One resolved, validated configuration snapshot. */
export interface ResolvedConfig {
  providers: Record<string, ResolvedProvider>
  active: string | undefined
  defaultPrompt: string
  maxBytes: number
  timeoutMs: number
  renderImagePreview: boolean
  allowPrivateNetwork: boolean
}

/**
 * Resolve one raw provider into validated connection facts. Programmatic
 * construction may bypass Schemastery normalization, so every default and
 * bound is re-judged here. `baseURL` and `model` may still be empty — a
 * provider card may be drafted incrementally; completeness is enforced only
 * when a provider is made `active` or actually used.
 * @param id - the provider key (for error messages).
 * @param provider - raw provider config.
 * @returns validated facts.
 */
export function resolveProvider(id: string, provider: Provider): ResolvedProvider {
  const baseURL = (provider.baseURL ?? '').trim().replace(/\/+$/, '')
  const model = (provider.model ?? '').trim()
  const apiKey = provider.apiKey
  if (apiKey !== undefined && apiKey.length === 0) {
    throw new Error(`image-mind: provider ${JSON.stringify(id)} apiKey must be non-empty when set`)
  }
  let apiKeyEnv: CredentialRef | undefined
  // An explicitly empty apiKeyEnv means "no credential seam" — a keyless
  // localhost endpoint; only an absent field falls back to the default.
  const rawEnv = (provider.apiKeyEnv === undefined ? DEFAULT_API_KEY_ENV : provider.apiKeyEnv).trim()
  if (rawEnv.length > 0) {
    try {
      apiKeyEnv = credentialRef(rawEnv)
    } catch {
      throw new Error(`image-mind: provider ${JSON.stringify(id)} apiKeyEnv ${JSON.stringify(rawEnv)} is not a valid environment-variable name`)
    }
  }
  const maxOutputTokens = provider.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const apiStyle = provider.apiStyle ?? DEFAULT_API_STYLE
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error(`image-mind: provider ${JSON.stringify(id)} maxOutputTokens must be a positive safe integer`)
  }
  if (!API_STYLES.includes(apiStyle)) {
    throw new Error(`image-mind: provider ${JSON.stringify(id)} apiStyle must be one of ${API_STYLES.map(style => JSON.stringify(style)).join(', ')}`)
  }
  return { baseURL, model, apiKey, apiKeyEnv, apiStyle, maxOutputTokens }
}

/** Whether a resolved provider names enough to place a real call. */
export function isProviderComplete(spec: ResolvedProvider): boolean {
  return /^https?:\/\//.test(spec.baseURL) && spec.model.length > 0
}

/**
 * Resolve raw config into validated connection facts. Every provider is
 * re-judged; `active` must name an existing, complete provider when set (an
 * incomplete provider may be drafted but not selected as the default).
 * @param config - raw plugin config.
 * @returns validated facts.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const rawProviders = config.providers ?? {}
  const providers: Record<string, ResolvedProvider> = {}
  for (const [id, provider] of Object.entries(rawProviders)) {
    providers[id] = resolveProvider(id, provider)
  }
  const active = config.active
  if (active !== undefined) {
    const trimmed = active.trim()
    if (trimmed.length === 0) {
      throw new Error('image-mind: active provider id must be non-empty when set')
    }
    if (!Object.hasOwn(providers, trimmed)) {
      throw new Error(`image-mind: active provider ${JSON.stringify(trimmed)} is not defined in providers`)
    }
    if (!isProviderComplete(providers[trimmed])) {
      throw new Error(`image-mind: active provider ${JSON.stringify(trimmed)} is incomplete; fill its baseURL and model first`)
    }
  }
  const maxBytes = config.maxBytes ?? 10 * 1024 * 1024
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  for (const [field, value] of [['maxBytes', maxBytes], ['timeoutMs', timeoutMs]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`image-mind: ${field} must be a positive safe integer`)
    }
  }
  return {
    providers,
    active: active === undefined ? undefined : active.trim(),
    defaultPrompt: config.defaultPrompt ?? DEFAULT_PROMPT,
    maxBytes,
    timeoutMs,
    renderImagePreview: config.renderImagePreview ?? DEFAULT_RENDER_IMAGE_PREVIEW,
    allowPrivateNetwork: config.allowPrivateNetwork ?? DEFAULT_ALLOW_PRIVATE_NETWORK,
  }
}

/**
 * Whether an endpoint root is a localhost-style address that needs no API key
 * (Ollama, LM Studio, vLLM on the same machine). Such endpoints authenticate
 * without a bearer, so the key seam may be left empty.
 */
export function isKeylessEndpoint(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}
