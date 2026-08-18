/**
 * Model discovery for OpenAI-compatible endpoints: GET /v1/models with the
 * connection's bearer, plus the known-plan fallback list when the endpoint
 * cannot answer. Discovery is a Host-side operation — the browser never holds
 * a key to interrogate an endpoint itself.
 * @module dsh-plugin-image-mind/adapters/openai-compatible/discovery
 */

import type { VisionConnection, VisionModel } from '@ran-sh/dsh-vision'
import { VisionError } from '@ran-sh/dsh-vision'
import { readBoundedBody } from '../../media/load.ts'

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

/** Known-good vision models for one endpoint root, or the generic list. */
export function planVisionModels(baseURL: string): readonly string[] {
  const lower = baseURL.toLowerCase()
  for (const plan of KNOWN_PLAN_VISION_MODELS) {
    if (lower.includes(plan.match)) return plan.models
  }
  return GENERIC_VISION_MODELS
}

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Discover models one OpenAI-compatible endpoint advertises. When the
 * endpoint cannot answer (no route, rejected key, non-OpenAI shape), the
 * known-plan fallback list is returned instead — discovery never fails a
 * picker that can still offer candidates.
 * @param connection - immutable connection facts (endpoint + key seam).
 * @param apiKey - resolved bearer token (may be empty for keyless endpoints).
 * @param signal - caller cancellation.
 * @returns endpoint models plus the plan fallback, and whether the endpoint list won.
 */
export async function discoverEndpointModels(
  connection: Readonly<VisionConnection>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ models: VisionModel[]; source: 'endpoint' | 'fallback'; reason?: string }> {
  const plan = planVisionModels(connection.baseURL)
  const fallback = (reason: string): { models: VisionModel[]; source: 'endpoint' | 'fallback'; reason?: string } =>
    ({ models: plan.map(id => ({ id })), source: 'fallback', reason })

  let response: Response
  try {
    response = await fetch(`${connection.baseURL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(15_000)]),
    })
  } catch (error) {
    if (signal?.aborted === true) throw error
    return fallback('端点未响应 /models 请求（网络失败或超时）')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return fallback('端点 /models 拒绝了凭据（HTTP 401/403）')
    return fallback(`端点 /models 返回 HTTP ${response.status}`)
  }
  let payload: unknown
  try {
    const bytes = await readBoundedBody(response, 256 * 1024)
    payload = JSON.parse(bytes.toString('utf8'))
  } catch {
    return fallback('端点 /models 返回了无法解析的响应')
  }
  const root = asRecord(payload)
  const data = root?.['data']
  if (!Array.isArray(data)) return fallback('端点 /models 不是 OpenAI 兼容格式')
  const ids: string[] = []
  for (const item of data) {
    const id = asRecord(item)?.['id']
    if (typeof id === 'string' && id.length > 0) ids.push(id)
  }
  if (ids.length === 0) return fallback('端点 /models 没有返回任何模型')
  // Known-good vision models for this plan lead the list (in priority order);
  // the endpoint's remaining roster follows, sorted, so the picker still
  // shows everything without reordering the verified choices.
  const planSet = new Set(plan)
  const extras = [...new Set(ids.filter(id => !planSet.has(id)))].sort((a, b) => a.localeCompare(b))
  return { models: [...plan, ...extras].map(id => ({ id })), source: 'endpoint' }
}

/** Normalize a discovery failure into a typed VisionError for the runtime. */
export function discoveryFailure(error: unknown): VisionError {
  if (error instanceof VisionError) return error
  return new VisionError(
    `image-mind: model discovery failed: ${(error as Error).message ?? String(error)}`,
    'NETWORK_ERROR',
    { cause: error },
  )
}
