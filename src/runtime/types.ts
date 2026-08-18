/**
 * Vision runtime vocabulary: the provider-neutral request/result types, the
 * immutable connection snapshot one call holds, and the provider descriptor
 * the registry exposes. Types only — no runtime code, so both the Host half
 * and tests import this freely.
 * @module dsh-plugin-image-mind/runtime/types
 */

import type { LoadedImage } from '../media/types.ts'
import type { ApiStyle } from '../config.ts'

/** One model the adapter can advertise for one provider. */
export interface VisionModel {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Whether the model accepts image input; absent means unknown. */
  vision?: boolean
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
}

/**
 * One vision request. `images` is a list so the adapter API can grow to
 * multi-image naturally; the tool consumer still passes one image today.
 */
export interface VisionRequest {
  /** Explicit provider id; absent selects the active provider. */
  provider?: string
  /** Model override; absent uses the provider's configured default. */
  model?: string
  /** The caller's instruction over the image(s). */
  prompt: string
  /** Loaded image bytes and their sniffed media type. */
  images: LoadedImage[]
  /** Caller cancellation; adapters must honor it. */
  signal?: AbortSignal
}

/** The outcome of one vision request. */
export interface VisionResult {
  /** The vision model's text answer. */
  text: string
  /** Provider route the answer came from. */
  provider: string
  /** Model id the answer came from. */
  model: string
  /** Token accounting when the endpoint disclosed it. */
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

/**
 * Immutable connection facts one request holds. Captured once at call time:
 * an in-flight request never observes a configuration change, and the next
 * call re-resolves. The API key is deliberately absent — it resolves through
 * {@link VisionConnectionOptions.resolveApiKey} against this snapshot so the
 * endpoint and the secret sent to it can never come from different
 * configuration generations.
 */
export interface VisionConnection {
  /** Provider route id. */
  provider: string
  /** Endpoint root; protocol paths append below it. */
  baseURL: string
  /** Model id to request. */
  model: string
  /** Wire protocol the endpoint speaks. */
  apiStyle: ApiStyle
  /** Output-token cap sent to the model. */
  maxOutputTokens: number
  /** Per-call request timeout in milliseconds. */
  timeoutMs: number
  /** Credential reference resolving the bearer token, when one is named. */
  apiKeyEnv?: string
}

/** The provider-side facts a registered adapter serves. */
export interface VisionProviderDescriptor {
  /** Provider route key used by {@link VisionRequest.provider}. */
  id: string
  /** Human-readable provider name for selectors and diagnostics. */
  displayName: string
  /** Adapter family serving this route. */
  adapter: string
  /** Endpoint root, when the descriptor carries one. */
  baseURL?: string
  /** Wire protocol the endpoint speaks. */
  apiStyle: ApiStyle
  /** Credential reference name for the API key, when one is conventional. */
  apiKeyEnv?: string
  /** Advisory models this provider can advertise. */
  models?: VisionModel[]
}

/**
 * One draft connection a configuration surface is still editing. The draft
 * carries its own credential so an interrogation never depends on a stored
 * key; a key typed but not yet stored travels here once.
 */
export interface VisionDraftConnection {
  /** Endpoint root to interrogate. */
  baseURL?: string
  /** Model id, when the draft names one. */
  model?: string
  /** Wire protocol the draft names. */
  apiStyle?: ApiStyle
  /** One-shot credential for this interrogation alone. */
  apiKey?: string
  /** Credential reference the draft resolves through, when one stands. */
  apiKeyEnv?: string
  /** Caller cancellation. */
  signal?: AbortSignal
}
