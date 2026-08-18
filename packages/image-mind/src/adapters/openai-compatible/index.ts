/**
 * The OpenAI-compatible adapter family barrel: one adapter serves every
 * chat-completions / responses endpoint, so OpenAI, OpenRouter, Command Code,
 * OpenCode, SiliconFlow, Groq, and the local endpoints share one fetch path.
 * @module dsh-plugin-image-mind/adapters/openai-compatible
 */

export { OpenAICompatibleVisionAdapter } from './adapter.ts'
export type { OpenAICompatibleAdapterOptions } from './adapter.ts'
export { semanticRequestKey } from './adapter.ts'
export { buildVisionRequest, extractChatCompletionsContent, extractResponsesContent } from './parse.ts'
export { discoverEndpointModels, planVisionModels } from './discovery.ts'
export { resolveBackoff, sleepBackoff } from './retry.ts'
export type { BackoffConfig } from './retry.ts'
