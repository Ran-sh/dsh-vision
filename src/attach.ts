/**
 * The /image-mind host routes: a browser-to-host upload seam that turns a
 * picked image into a durable attachment reference, plus the raw route that
 * serves stored bytes so a pasted reference renders in the conversation. The
 * upload returns the `[image attachment …]` note and the markdown reference
 * the browser half splices into the send; the image bytes themselves never
 * cross into the conversation log — they live in the attachment store.
 *
 * Works without any plugin configuration: the byte bound falls back to the
 * default and the attachment service is resolved per call.
 * @module dsh-plugin-image-mind/attach
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { decodeBase64, isImageMimeType, sniffMimeType, DEFAULT_MAX_BYTES, type ImageMimeType } from './media.ts'
import { DEFAULT_API_STYLE, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_TIMEOUT_MS, IMAGE_MIND_SETTINGS_NAMESPACE, isKeylessEndpoint, resolveApiKey, resolveProvider, type ApiStyle, type ResolvedProvider } from './config.ts'
import { callVision, readBoundedBody, type LoadedImage } from './vision.ts'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

/**
 * Post /image-mind/test — "Test connection" for the settings card. The card
 * sends the draft field values (including unsaved edits) to the host, which
 * runs one real vision request against the endpoint with a tiny embedded
 * image and reports the outcome. The request goes out from the host process,
 * so the resolved key never crosses to the browser and every transport
 * guarantee of a normal call still applies.
 */

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
function draftProvider(id: string, overrides: TestConnectionOverrides, saved: Record<string, unknown>): ResolvedProvider {
  const baseURL = String(overrides.baseURL ?? saved.baseURL ?? '').trim().replace(/\/+$/, '')
  const model = String(overrides.model ?? saved.model ?? '').trim()
  if (baseURL.length === 0 || model.length === 0) {
    throw new Error('image-mind: 请先填写视觉端点地址（baseURL）和模型（model）')
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
 * required — `/models` needs the baseURL and a key, never a model id, so the
 * picker works before a model is chosen. Key resolution mirrors
 * {@link draftProvider}; localhost endpoints stay keyless.
 */
function draftProviderForListing(id: string, overrides: TestConnectionOverrides, saved: Record<string, unknown>): ResolvedProvider {
  const baseURL = String(overrides.baseURL ?? saved.baseURL ?? '').trim().replace(/\/+$/, '')
  if (baseURL.length === 0) {
    throw new Error('image-mind: 请先填写视觉端点地址（baseURL）')
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

/**
 * Run one real vision request with the given draft overrides layered over the
 * saved section, and report whether the deployment connects.
 * @param ctx - registrant context.
 * @param overrides - draft field values from the card (may be partial).
 * @returns the model's reply on success, or a readable failure reason.
 */
export async function runConnectionTest(ctx: Context, overrides: TestConnectionOverrides): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const settings = ctx.get('settings')
  const saved = settings !== undefined
    ? (settings.get(IMAGE_MIND_SETTINGS_NAMESPACE) ?? {}) as Record<string, unknown>
    : {}
  let spec: ResolvedProvider
  try {
    spec = draftProvider('test', overrides, saved)
  } catch (error) {
    return { ok: false, message: (error as Error).message.replace(/^image-mind: /, '') }
  }
  let apiKey: string
  try {
    apiKey = await resolveApiKey(ctx, spec)
  } catch (error) {
    return { ok: false, message: (error as Error).message.replace(/^image-mind: /, '') }
  }
  const timeoutMs = Math.max(1, Math.min(Number(overrides.timeoutMs ?? saved.timeoutMs ?? DEFAULT_TIMEOUT_MS), 30_000))
  const image: LoadedImage = { bytes: Buffer.from(TEST_IMAGE_BASE64, 'base64'), mimeType: 'image/png' }
  try {
    const text = await callVision(spec, apiKey, 'Reply with exactly one short word: OK', image, AbortSignal.timeout(timeoutMs), timeoutMs)
    return { ok: true, text: text.trim() }
  } catch (error) {
    return { ok: false, message: (error as Error).message.replace(/^image-mind: /, '') }
  }
}

/**
 * Read the section's saved connection facts (base URL, model, key seam) so a
 * host route can layer draft overrides over them exactly like a real call.
 * @param ctx - registrant context.
 * @returns the saved section as a loose record (empty when unset).
 */
function savedSection(ctx: Context): Record<string, unknown> {
  const settings = ctx.get('settings')
  if (settings === undefined) return {}
  return (settings.get(IMAGE_MIND_SETTINGS_NAMESPACE) ?? {}) as Record<string, unknown>
}

/**
 * Vision models grouped by endpoint, matched on the root hostname. The two
 * hosted plans this deployment uses are `opencode go` (bare ids) and
 * `commandcode goat` (vendor-prefixed ids); the rest are common official
 * OpenAI-compatible endpoints. A matched plan's models become the default
 * picker candidates and are promoted above the endpoint's full roster.
 * Endpoints matching no known plan fall back to a small generic list.
 */
const KNOWN_PLAN_VISION_MODELS: ReadonlyArray<{ match: string; models: readonly string[] }> = [
  {
    match: 'commandcode.ai',
    models: [
      'xiaomi/mimo-v2.5',
      'moonshotai/Kimi-K3',
      'gpt-5.6-luna',
      'google/gemini-3.7-flash',
      'MiniMaxAI/MiniMax-M3',
      'stepfun/Step-3.7-Flash',
      'nvidia/nemotron-3-ultra-550b-a55b',
    ],
  },
  {
    match: 'opencode.ai',
    models: ['mimo-v2.5', 'kimi-k3'],
  },
  {
    // 阿里云百炼 / DashScope（OpenAI 兼容模式）
    match: 'dashscope',
    models: ['qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-72b-instruct', 'qwen2.5-vl-32b-instruct', 'qwen2.5-vl-7b-instruct'],
  },
  {
    // 智谱 AI 开放平台（bigmodel.cn）
    match: 'bigmodel.cn',
    models: ['glm-4v', 'glm-4v-plus', 'glm-4v-flash', 'glm-4.6v'],
  },
  {
    // Moonshot Kimi 开放平台
    match: 'moonshot.cn',
    models: ['moonshot-v1-8k-vision-preview', 'moonshot-v1-32k-vision-preview', 'moonshot-v1-128k-vision-preview', 'kimi-latest'],
  },
  {
    // 火山方舟（豆包）
    match: 'volces.com',
    models: ['doubao-1.5-vision-pro', 'doubao-vision-pro-32k'],
  },
  {
    // 腾讯混元
    match: 'hunyuan',
    models: ['hunyuan-vision', 'hunyuan-turbo-vision', 'hunyuan-standard-vision'],
  },
  {
    // Google Gemini（OpenAI 兼容端点 /v1beta/openai/）
    match: 'generativelanguage.googleapis.com',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  },
  {
    // OpenAI 官方
    match: 'openai.com',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4-turbo'],
  },
  {
    // 硅基流动 SiliconFlow
    match: 'siliconflow.cn',
    models: ['Qwen/Qwen2.5-VL-72B-Instruct', 'Qwen/Qwen2.5-VL-32B-Instruct'],
  },
  {
    // OpenRouter（模型名带 vendor 前缀）
    match: 'openrouter.ai',
    models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001', 'qwen/qwen-2.5-vl-72b-instruct'],
  },
  {
    // Groq
    match: 'groq.com',
    models: ['llama-3.2-90b-vision-preview', 'llama-3.2-11b-vision-preview'],
  },
  {
    // Mistral AI
    match: 'mistral.ai',
    models: ['pixtral-12b-2409', 'pixtral-large-latest'],
  },
  {
    // Together AI
    match: 'together.xyz',
    models: ['meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo'],
  },
  {
    // Fireworks AI
    match: 'fireworks.ai',
    models: ['accounts/fireworks/models/llama-v3p2-90b-vision-instruct'],
  },
  {
    // NVIDIA NIM
    match: 'api.nvidia.com',
    models: ['meta/llama-3.2-90b-vision-instruct'],
  },
  {
    // DeepInfra
    match: 'deepinfra.com',
    models: ['meta-llama/Llama-3.2-90B-Vision-Instruct'],
  },
  {
    // Hyperbolic
    match: 'hyperbolic.xyz',
    models: ['meta-llama/Llama-3.2-90B-Vision-Instruct'],
  },
  {
    // MiniMax（国际 / 国内 OpenAI 兼容端点）
    match: 'minimax',
    models: ['abab6.5s-chat', 'MiniMax-VL-01'],
  },
  {
    // xAI Grok
    match: 'x.ai',
    models: ['grok-2-vision-1212'],
  },
  {
    // 百度千帆 ERNIE（OpenAI 兼容 v2）
    match: 'qianfan.baidubce.com',
    models: ['ernie-4.5-vl-8k-preview', 'ernie-vl-2.0'],
  },
  {
    // 本地 Ollama
    match: 'localhost:11434',
    models: ['llava', 'llava:13b', 'minicpm-v', 'qwen2.5-vl', 'moondream'],
  },
  {
    // 本地 LM Studio
    match: 'localhost:1234',
    models: ['llava', 'qwen2.5-vl', 'minicpm-v'],
  },
]

/** Generic fallback for endpoints that match no known plan. */
const GENERIC_VISION_MODELS = [
  'mimo-v2.5', 'kimi-k3', 'qwen-vl-max', 'qwen-vl-plus', 'gpt-4o', 'gpt-4o-mini',
  'glm-4v', 'glm-4v-plus', 'gemini-2.0-flash', 'llava', 'minicpm-v',
] as const

/**
 * The official-provider catalog the "添加提供方" flow offers: a pick from a
 * known directory (name + endpoint root + default model + default key-env
 * reference), so adding a provider is one choice, like the built-in Models
 * page's "添加提供方". "添加自定义提供方" remains a blank card.
 */
export interface VisionProviderCatalogEntry {
  /** Provider id (settings key), e.g. `opencode-go`. */
  id: string
  /** Human-facing name. */
  name: string
  /** Endpoint root the provider answers through. */
  baseURL: string
  /** Default vision model on that endpoint. */
  defaultModel: string
  /** Conventional credential-reference (env-var) name for its key. */
  apiKeyEnv: string
}

/** The catalog rows offered by "添加提供方". */
export const VISION_PROVIDER_CATALOG: readonly VisionProviderCatalogEntry[] = [
  {
    id: 'opencode-go',
    name: 'Opencode Go',
    baseURL: 'https://opencode.ai/zen/go/v1',
    defaultModel: 'mimo-v2.5',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
  },
  {
    id: 'commandcode-goat',
    name: 'Command Code Goat',
    baseURL: 'https://api.commandcode.ai/provider/v1',
    defaultModel: 'xiaomi/mimo-v2.5',
    apiKeyEnv: 'COMMANDCODE_API_KEY',
  },
  {
    id: 'dashscope',
    name: '阿里云百炼（DashScope）',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-vl-max',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
  },
  {
    id: 'bigmodel',
    name: '智谱 AI（BigModel）',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4v',
    apiKeyEnv: 'BIGMODEL_API_KEY',
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k-vision-preview',
    apiKeyEnv: 'MOONSHOT_API_KEY',
  },
  {
    id: 'volcengine',
    name: '火山方舟（豆包）',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1.5-vision-pro',
    apiKeyEnv: 'VOLC_ARK_API_KEY',
  },
  {
    id: 'hunyuan',
    name: '腾讯混元',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    defaultModel: 'hunyuan-vision',
    apiKeyEnv: 'HUNYUAN_API_KEY',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    baseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.2-90b-vision-preview',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'pixtral-12b-2409',
    apiKeyEnv: 'MISTRAL_API_KEY',
  },
  {
    id: 'together',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
    apiKeyEnv: 'TOGETHER_API_KEY',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p2-90b-vision-instruct',
    apiKeyEnv: 'FIREWORKS_API_KEY',
  },
  {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.2-90b-vision-instruct',
    apiKeyEnv: 'NVIDIA_NIM_API_KEY',
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Llama-3.2-90B-Vision-Instruct',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
  },
  {
    id: 'hyperbolic',
    name: 'Hyperbolic',
    baseURL: 'https://api.hyperbolic.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.2-90B-Vision-Instruct',
    apiKeyEnv: 'HYPERBOLIC_API_KEY',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    defaultModel: 'abab6.5s-chat',
    apiKeyEnv: 'MINIMAX_API_KEY',
  },
  {
    id: 'grok',
    name: 'xAI Grok',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-vision-1212',
    apiKeyEnv: 'XAI_API_KEY',
  },
  {
    id: 'qianfan',
    name: '百度千帆（ERNIE）',
    baseURL: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-4.5-vl-8k-preview',
    apiKeyEnv: 'QIANFAN_API_KEY',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llava',
    apiKeyEnv: '',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio（本地）',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'llava',
    apiKeyEnv: '',
  },
]

/** Known-good vision models for one endpoint root, or the generic list. */
function planVisionModels(baseURL: string): readonly string[] {
  const lower = baseURL.toLowerCase()
  for (const plan of KNOWN_PLAN_VISION_MODELS) {
    if (lower.includes(plan.match)) return plan.models
  }
  return GENERIC_VISION_MODELS
}

/**
 * List model ids an OpenAI-compatible endpoint advertises through GET
 * /v1/models. Unlike `runConnectionTest` this never errors out: when the
 * endpoint lacks the route, rejects the key, or answers in a non-OpenAI shape,
 * the caller still gets a fallback list so the picker stays usable. The key
 * travels from the host process only.
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
    return { ok: false, message: (error as Error).message.replace(/^image-mind: /, '') }
  }
  const { baseURL } = spec
  const plan = planVisionModels(baseURL)
  let apiKey: string
  try {
    apiKey = await resolveApiKey(ctx, spec)
  } catch (error) {
    return { ok: true, models: [...plan], source: 'fallback', reason: (error as Error).message.replace(/^image-mind: /, '') }
  }
  const fallback = { ok: true as const, models: [...plan], source: 'fallback' as const }
  let response: Response
  try {
    response = await fetch(`${baseURL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { ...fallback, reason: '端点未响应 /models 请求（网络失败或超时）' }
  }
  if (!response.ok) {
    return { ...fallback, reason: `端点 /models 返回 HTTP ${response.status}` }
  }
  const payloadBytes = await readBoundedBody(response, 256 * 1024)
  let payload: unknown
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    return { ...fallback, reason: '端点 /models 返回了无法解析的响应' }
  }
  const root = asRecord(payload)
  const data = root?.['data']
  if (!Array.isArray(data)) return { ...fallback, reason: '端点 /models 不是 OpenAI 兼容格式' }
  const ids: string[] = []
  for (const item of data) {
    const id = asRecord(item)?.['id']
    if (typeof id === 'string' && id.length > 0) ids.push(id)
  }
  if (ids.length === 0) return { ...fallback, reason: '端点 /models 没有返回任何模型' }
  // Known-good vision models for this plan lead the list (in priority order);
  // the endpoint's remaining roster follows, sorted, so the picker still
  // shows everything without reordering the verified choices.
  const planSet = new Set(plan)
  const extras = [...new Set(ids.filter(id => !planSet.has(id)))].sort((a, b) => a.localeCompare(b))
  return { ok: true, models: [...plan, ...extras], source: 'endpoint' }
}

/** Request-body byte cap: base64 of a 10 MiB image plus envelope slack. */
export const MAX_ATTACH_BODY_BYTES = 16 * 1024 * 1024

/** The host route prefix both halves agree on. */
export const ROUTE_PREFIX = '/image-mind'

/** Error text shown when a model-supplied attachment reference does not validate. */
const ATTACHMENT_REF_GUIDANCE =
  'image-mind: image is not a valid attachment reference; copy the exact JSON from the [image attachment …] note'

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

/** Read a JSON request body up to a byte cap; null when unparseable or oversized. */
async function readJsonBody(req: IncomingMessage, cap: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    chunks.push(buffer)
    total += buffer.length
    if (total > cap) return null
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Write one JSON envelope response. */
function json(res: ServerResponse, envelope: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * Serve one stored image by its bare attachment id (the GET half of the prefix
 * route). Unknown ids and store failures answer 404; the media type comes
 * from the registered reference, never from the URL.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param req - the incoming GET request.
 * @param res - the outgoing response.
 */
async function serveRawImage(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const match = new RegExp(`^${ROUTE_PREFIX}/raw/([^/]+)$`).exec(new URL(req.url ?? '/', 'http://x').pathname)
  if (match === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const id = decodeURIComponent(match[1])
  const ref = attachmentRefById(id)
  if (ref === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const stored = await attachments.readImage(ref)
    res.writeHead(200, { 'content-type': ref.mediaType, 'content-length': String(stored.data.byteLength), 'cache-control': 'private, max-age=3600' })
    res.end(Buffer.from(stored.data))
  } catch {
    res.writeHead(404)
    res.end()
  }
}

/**
 * Redacted view of the image-mind settings section, safe for the browser:
 * secret fields are replaced by a `configured` flag, never their values.
 */
export interface ConfigView {
  /** Monotonic revision fencing the next write. */
  revision: number
  /** Resolved section with every secret stripped; per-provider `apiKeyConfigured`/`apiKeyMask`. */
  value: Record<string, unknown>
  /** Composition `base` layer (redacted), if the mount declared one. */
  base?: unknown
  /** Raw user section from the stored document (redacted), when one exists. */
  user?: unknown
  /** Whether the settings provider accepts writes. */
  writable: boolean
}

/** One provider as the browser sees it: secret replaced by flags, never a value. */
export interface ProviderView {
  baseURL?: string
  model?: string
  apiKeyEnv?: string
  apiStyle?: string
  maxOutputTokens?: number
  /** Whether the provider has an inline `apiKey` set in the stored document. */
  apiKeyConfigured: boolean
  /** `*` repeated for the resolved key's length; empty when no key resolves. */
  apiKeyMask: string
  /**
   * Whether the provider can actually authenticate today: endpoint+model are
   * named and a key resolves (inline or through the env seam). This is the
   * row's status lamp truth — a provider without a usable key is never
   * "connected".
   */
  keyReady: boolean
  /** Whether endpoint and model are both filled (regardless of key). */
  complete: boolean
}

/** The image-mind section as the browser edits it. */
export interface ConfigSection {
  /** Monotonic revision the caller read; refuses stale writes. */
  expectedRevision?: number
  /** Path-addressed writes; set stores, unset clears to re-inherit. */
  ops: Array<{ op: 'set'; path: readonly string[]; value: unknown } | { op: 'unset'; path: readonly string[] }>
}

/** Mask source constant for a configured API key; the mask width mirrors the key length. */
const API_KEY_MASK_CHAR = '*'

/**
 * Whether the deployment currently has a usable vision key, and its mask.
 * The mask is `*` repeated for the key's length — the card reads "set" (and
 * how long) at a glance; only the length leaves the host, never the key.
 * @param ctx - registrant context.
 * @param envName - credential-reference name for the API key.
 * @param inlineKeyLength - non-empty inline key length, or undefined when absent.
 * @returns the mask for a usable key, or an empty string when no key resolves.
 */
async function resolveKeyMask(ctx: Context, envName: string | undefined, inlineKeyLength: number | undefined): Promise<string> {
  if (inlineKeyLength !== undefined && inlineKeyLength > 0) return API_KEY_MASK_CHAR.repeat(inlineKeyLength)
  if (typeof envName !== 'string' || envName.length === 0) return ''
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(credentialRef(envName))
      return hit !== undefined ? API_KEY_MASK_CHAR.repeat(hit.value.length) : ''
    } catch {
      return ''
    }
  }
  const ambient = launchEnvironmentOf(ctx).get(envName)
  return ambient !== undefined && ambient.value.length > 0 ? API_KEY_MASK_CHAR.repeat(ambient.value.length) : ''
}

/** A description descriptor as the config view reads it. */
interface ConfigDescriptor {
  ns: string
  revision?: number
  value?: unknown
  base?: unknown
  user?: unknown
  /** Secret positions enumerated under redaction; `set` says the field held a value. */
  secrets?: Array<{ path: string[]; set: boolean }>
}

/** Build the redacted config view from the registered section descriptor. */
async function configView(ctx: Context, settings: { describe(options: { redactSecrets: true }): ConfigDescriptor[]; get(ns: string): unknown }, writable: boolean): Promise<ConfigView | undefined> {
  const desc = settings.describe({ redactSecrets: true }).find(d => d.ns === IMAGE_MIND_SETTINGS_NAMESPACE)
  if (desc === undefined) return undefined
  const value = (desc.value ?? {}) as Record<string, unknown>
  const raw = (settings.get(IMAGE_MIND_SETTINGS_NAMESPACE) ?? {}) as Record<string, unknown>
  const rawProviders = asRecord(raw['providers'])
  // Enrich each provider with key flags: whether the inline `apiKey` is set
  // (from the secret enumeration) and the resolved key's mask (host-process
  // only, never the value). The inline key length is read from the raw stored
  // section; the env-seam mask comes from resolving `apiKeyEnv`.
  const providerRecords = asRecord(value['providers'])
  const providers: Record<string, ProviderView> = {}
  if (providerRecords !== undefined) {
    for (const [id, pv] of Object.entries(providerRecords)) {
      const p = asRecord(pv) ?? {}
      const inlineSet = desc.secrets?.some(secret =>
        secret.path.length === 3 && secret.path[0] === 'providers' && secret.path[1] === id && secret.path[2] === 'apiKey' && secret.set) ?? false
      let inlineKeyLength: number | undefined
      if (inlineSet) {
        const rp = asRecord(rawProviders?.[id])
        if (typeof rp?.['apiKey'] === 'string') inlineKeyLength = rp['apiKey'].length
      }
      const apiKeyEnv = typeof p['apiKeyEnv'] === 'string' ? p['apiKeyEnv'] : undefined
      const mask = await resolveKeyMask(ctx, apiKeyEnv, inlineKeyLength)
      const baseURL = typeof p['baseURL'] === 'string' ? p['baseURL'] : ''
      const model = typeof p['model'] === 'string' ? p['model'] : ''
      const complete = baseURL.trim().length > 0 && model.trim().length > 0
      // A localhost endpoint is keyless, so it counts as key-ready when complete.
      const keyReady = mask.length > 0 || (complete && isKeylessEndpoint(baseURL))
      providers[id] = {
        ...p,
        apiKeyConfigured: inlineSet,
        apiKeyMask: mask,
        keyReady,
        complete,
      }
    }
  }
  const nextValue: Record<string, unknown> = { ...value, providers }
  return {
    revision: desc.revision ?? 0,
    value: nextValue,
    ...desc.base === undefined ? {} : { base: desc.base },
    ...desc.user === undefined ? {} : { user: desc.user },
    writable,
  }
}

/**
 * Read the image-mind settings section for the browser card. The card cannot
 * use the official settings wire (its namespace allowlist is hardcoded to
 * product namespaces), so the plugin serves its own redacted view through the
 * host process — the settings provider answers in-process, outside that gate.
 * @param ctx - registrant context.
 * @returns the redacted view, or undefined while the section is unregistered.
 */
export async function readConfigView(ctx: Context): Promise<ConfigView | undefined> {
  const settings = ctx.get('settings')
  if (settings === undefined) return undefined
  return configView(ctx, settings, settings.writable)
}

/**
 * Apply the browser card's field writes to the image-mind section through the
 * host settings provider (`mutate`: path-addressed, redacted-view safe). The
 * provider validates against the registered schema and persists to the
 * settings document; a rejection carries the seam's message for the card.
 * @param ctx - registrant context.
 * @param body - the parsed request body.
 * @returns the new redacted view, or a structured rejection.
 */
export async function writeConfigView(ctx: Context, body: unknown): Promise<{ ok: true; value: ConfigView } | { ok: false; error: AttachError }> {
  const settings = ctx.get('settings')
  if (settings === undefined) {
    return { ok: false, error: { code: 'internal', message: 'the settings service is not mounted; cannot persist image-mind config' } }
  }
  const record = body as ConfigSection | undefined
  if (typeof record !== 'object' || record === null || !Array.isArray(record.ops)) {
    return { ok: false, error: { code: 'rejected', message: 'request body must be a JSON object with an ops array' } }
  }
  for (const op of record.ops) {
    if (op.op !== 'set' && op.op !== 'unset') {
      return { ok: false, error: { code: 'rejected', message: 'each op must be a set or unset write' } }
    }
    // Accept nested paths: a top-level field (length 1) or a provider field
    // (`providers`, id, field). Anything else is rejected.
    const path = op.path
    const valid = Array.isArray(path) && path.length >= 1 && path.length <= 3
      && path.every(seg => typeof seg === 'string' && seg.length > 0)
      && (path.length === 1 || (path[0] === 'providers' && path.length === 3))
    if (!valid) {
      return { ok: false, error: { code: 'rejected', message: 'each op must carry a valid path (a top-level field, or providers.<id>.<field>)' } }
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (settings as any).mutate(IMAGE_MIND_SETTINGS_NAMESPACE, record.ops, record.expectedRevision)
  } catch (error) {
    return { ok: false, error: { code: 'rejected', message: (error as Error).message ?? String(error) } }
  }
  const view = await configView(ctx, settings, settings.writable)
  if (view === undefined) {
    return { ok: false, error: { code: 'internal', message: 'image-mind section vanished after write' } }
  }
  return { ok: true, value: view }
}

/**
 * Register the /image-mind prefix route on the shared webserver: POST
 * /image-mind/attach uploads, GET /image-mind/raw/<id> serves stored bytes.
 * The byte bound is read per request so a settings change lands immediately.
 * @param ctx - registrant context; webServer is optional and probed per call.
 * @param readMaxBytes - per-request byte-bound reader (defaults to the constant).
 */
export function registerAttachRoute(ctx: Context, readMaxBytes: () => number = () => DEFAULT_MAX_BYTES): void {
  const webserver = ctx.get('webServer')
  if (webserver === undefined) return
  webserver.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      // GET /image-mind/config: redacted settings view for the card.
      if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/config`) {
        const view = await readConfigView(ctx)
        if (view === undefined) {
          json(res, { ok: false, error: { code: 'internal', message: 'image-mind settings section is not registered' } }, 500)
          return
        }
        json(res, { ok: true, value: view })
        return
      }
      // POST /image-mind/config: persist the card's staged writes.
      if (req.method === 'POST' && pathname === `${ROUTE_PREFIX}/config`) {
        const body = await readJsonBody(req, 64 * 1024)
        if (body === null) {
          json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON' } }, 400)
          return
        }
        const outcome = await writeConfigView(ctx, body)
        if (outcome.ok) {
          json(res, { ok: true, value: outcome.value })
          return
        }
        json(res, { ok: false, error: outcome.error }, outcome.error.code === 'rejected' ? 422 : 500)
        return
      }
      // POST /image-mind/test: one real vision call to verify the deployment.
      if (req.method === 'POST' && pathname === `${ROUTE_PREFIX}/test`) {
        const body = await readJsonBody(req, 64 * 1024)
        if (body === null) {
          json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON' } }, 400)
          return
        }
        const outcome = await runConnectionTest(ctx, (body ?? {}) as TestConnectionOverrides)
        if (outcome.ok) {
          json(res, { ok: true, value: { text: outcome.text } })
          return
        }
        json(res, { ok: false, error: { code: 'rejected', message: outcome.message } }, 422)
        return
      }
      // POST /image-mind/models: list model ids for the current endpoint so the
      // card can offer a picker instead of a bare text field.
      if (req.method === 'POST' && pathname === `${ROUTE_PREFIX}/models`) {
        const body = await readJsonBody(req, 64 * 1024)
        if (body === null) {
          json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON' } }, 400)
          return
        }
        const outcome = await listEndpointModels(ctx, (body ?? {}) as TestConnectionOverrides)
        if (outcome.ok) {
          json(res, { ok: true, value: outcome })
          return
        }
        json(res, { ok: false, error: { code: 'rejected', message: outcome.message } }, 422)
        return
      }
      // GET /image-mind/catalog: the official vision-provider directory the
      // "添加提供方" flow offers; "添加自定义提供方" stays a blank card.
      if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/catalog`) {
        json(res, { ok: true, value: { catalog: VISION_PROVIDER_CATALOG } })
        return
      }
      // GET /image-mind/raw/<id>: serve the stored bytes so the markdown
      // image reference inserted into the send renders. The id is
      // content-addressed, so a bare read carries no secrets.
      if (req.method === 'GET') {
        await serveRawImage(ctx, req, res)
        return
      }
      if (req.method !== 'POST') {
        json(res, { ok: false, error: { code: 'internal', message: 'only GET and POST are allowed' } }, 405)
        return
      }
      const body = await readJsonBody(req, MAX_ATTACH_BODY_BYTES)
      if (body === null) {
        json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON within 16 MiB' } }, 400)
        return
      }
      const outcome = await handleAttach(ctx, readMaxBytes(), body)
      if (outcome.ok) {
        json(res, { ok: true, value: { note: outcome.note, markdown: outcome.markdown, ref: outcome.ref } })
        return
      }
      json(res, { ok: false, error: outcome.error }, outcome.error.code === 'rejected' ? 422 : 500)
    },
  })
}
