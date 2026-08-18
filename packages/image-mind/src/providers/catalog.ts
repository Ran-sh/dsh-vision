/**
 * The built-in vision-provider template directory the "添加提供方" flow offers. Pure
 * data — no requests, no credential logic. The adapter that serves a catalog
 * entry is chosen by its `apiStyle`; the runtime layers the catalog under the
 * user's settings.
 * @module dsh-plugin-image-mind/providers/catalog
 */

import type { ApiStyle } from '../config.ts'

/** One built-in provider template the directory offers. */
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
  /** Wire protocol the endpoint speaks; defaults to chat-completions. */
  apiStyle?: ApiStyle
}

/** The template rows offered by "添加提供方". */
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
