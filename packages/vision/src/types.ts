/**
 * Vision runtime vocabulary: the provider-neutral request/result types, the
 * immutable connection snapshot one call holds, and the provider descriptor
 * the registry exposes. Types only — no runtime code — and self-contained:
 * this package must not know any concrete vision vendor, settings namespace,
 * credential reference, attachment store, or wire protocol family, so the
 * few structural types it needs (loaded image, protocol style) are declared
 * here rather than imported from a provider package.
 * @module @ran-sh/dsh-vision/types
 */

/** Image media types the vision seam accepts (structural, provider-neutral). */
export type VisionImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** One loaded image: its bytes and the sniffed media type. */
export interface LoadedImage {
  bytes: Buffer
  mimeType: VisionImageMimeType
}

/** Wire protocol styles a vision provider endpoint may speak. */
export type VisionApiStyle = 'chat-completions' | 'responses'

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
 *
 * The request names only what the caller wants — which provider/model, what
 * prompt over which images, and cancellation. It carries NO connection facts
 * (baseURL, apiKeyEnv, apiStyle, timeout): those belong to the provider's
 * registration and are resolved by the runtime into an immutable snapshot.
 */
export interface VisionRequest {
  /** Provider id to use; absent selects the runtime's active provider. */
  provider?: string
  /** Model id override; absent uses the provider's configured default. */
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
 * Immutable connection facts one request holds. Captured by the runtime at
 * call time and deep-frozen before the adapter sees it: an in-flight request
 * never observes a configuration change, and the next call re-resolves. The
 * API key is deliberately absent — it resolves through the registration's
 * key resolver against this snapshot so the endpoint and the secret sent to
 * it can never come from different configuration generations.
 */
export interface VisionConnection {
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

/** How one provider route resolves its connection facts for each call. */
export type VisionConnectionResolver = (request: VisionRequest) => Promise<VisionConnection> | VisionConnection

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
  apiStyle: VisionApiStyle
  /** Credential reference name for the API key, when one is conventional. */
  apiKeyEnv?: string
  /** Advisory models this provider can advertise. */
  models?: VisionModel[]
}

/**
 * One draft connection a configuration surface is still editing. The draft
 * carries its own credential so an interrogation never depends on a stored
 * key; a key typed but not yet stored travels here once. The runtime turns a
 * draft into a connection snapshot internally — consumers never construct a
 * full `VisionConnection` by hand for discovery.
 */
export interface VisionDraftConnection {
  /** Endpoint root to interrogate. */
  baseURL?: string
  /** Model id, when the draft names one. */
  model?: string
  /** Wire protocol the draft names. */
  apiStyle?: VisionApiStyle
  /** One-shot credential for this interrogation alone. */
  apiKey?: string
  /** Credential reference the draft resolves through, when one stands. */
  apiKeyEnv?: string
  /** Per-call request timeout for the probe, in milliseconds. */
  timeoutMs?: number
  /** Output-token cap for the probe. */
  maxOutputTokens?: number
  /** Caller cancellation. */
  signal?: AbortSignal
}

/**
 * Discovery request: a registered provider route to interrogate, or — when a
 * configuration surface is still editing — a draft connection to ask instead.
 * Consumers never construct a full `VisionConnection` for discovery.
 */
export interface VisionDiscoveryRequest {
  /** Provider route to interrogate; absent uses `draft`. */
  provider?: string
  /** Draft connection to interrogate when the route is not yet stored. */
  draft?: VisionDraftConnection
}
