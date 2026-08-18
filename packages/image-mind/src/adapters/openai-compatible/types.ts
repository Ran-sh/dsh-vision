/**
 * OpenAI-compatible vision endpoint facts, owned by this adapter family.
 * The adapter resolves these per call from the provider id (settings /
 * last-good / model override) and captures an immutable snapshot, so an
 * in-flight request never observes a configuration change and the next call
 * re-resolves. This vocabulary stays inside dsh-plugin-image-mind — the
 * vision service package never sees an endpoint, a protocol style, or a
 * credential reference.
 * @module dsh-plugin-image-mind/adapters/openai-compatible/types
 */

/** Protocol styles the tool can speak to the configured endpoint. */
export const API_STYLES = ['chat-completions', 'responses'] as const
export type VisionApiStyle = typeof API_STYLES[number]

/** Protocol style used unless the configuration overrides it. */
export const DEFAULT_API_STYLE: VisionApiStyle = 'chat-completions'

/**
 * The immutable endpoint facts one call holds. Captured by the adapter at
 * call time and deep-frozen before the wire layer sees it: an in-flight
 * request never observes a configuration change, and the next call
 * re-resolves. The credential reference travels with the endpoint so a
 * request can never pair one generation's endpoint with another generation's
 * secret; the literal key itself is resolved per request and never stored on
 * the snapshot.
 */
export interface OpenAICompatibleVisionOptions {
  /** Provider route id. */
  readonly provider: string
  /** Endpoint root; protocol paths append below it. */
  readonly baseURL: string
  /** Model id to request. */
  readonly model: string
  /** Wire protocol the endpoint speaks. */
  readonly apiStyle: VisionApiStyle
  /** Output-token cap sent to the model. */
  readonly maxOutputTokens: number
  /** Per-call request timeout in milliseconds. */
  readonly timeoutMs: number
  /** Credential reference resolving the bearer token, when one is named. */
  readonly apiKeyEnv?: string
  /**
   * One-shot credential for a probe/draft connection only. Never persisted,
   * never crosses to the browser; resolution prefers it over `apiKeyEnv`.
   */
  readonly inlineApiKey?: string
}
