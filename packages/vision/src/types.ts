/**
 * Vision runtime vocabulary: the provider-neutral request/result types, the
 * model metadata, and the provider descriptor the registry exposes. Types
 * only — no runtime code — and self-contained: this package must not know any
 * concrete vision vendor, settings namespace, credential reference,
 * attachment store, or wire protocol family, so the structural types it needs
 * (loaded image, request, result) are declared here rather than imported from
 * a provider package.
 * @module @ran-sh/dsh-vision/types
 */

/** Image media types the vision seam accepts (structural, provider-neutral). */
export type VisionImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** One loaded image: its bytes and the sniffed media type. */
export interface LoadedImage {
  bytes: Buffer
  mimeType: VisionImageMimeType
}

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
  /** Output-token cap this model accepts, when disclosed. */
  maxOutputTokens?: number
  /** Whether the model can take more than one image per request. */
  supportsMultipleImages?: boolean
  /** Whether the model exposes a reasoning mode. */
  supportsReasoning?: boolean
}

/**
 * One vision request. `images` is a list so the adapter API can grow to
 * multi-image naturally; the tool consumer still passes one image today.
 *
 * The request names only what the caller wants — which provider/model, what
 * prompt over which images, the output cap the answer may use, and
 * cancellation. It carries NO connection facts: how the provider reaches an
 * endpoint, authenticates, serializes the request, or times it out is the
 * registered adapter's own concern, never the runtime's.
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
  /** Output-token cap the caller wants for the answer. */
  maxOutputTokens?: number
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

/** Discovery request: a registered provider route to interrogate. */
export interface VisionModelDiscoveryRequest {
  /** Provider route to interrogate. */
  provider: string
  /** Caller cancellation; adapters must honor it. */
  signal?: AbortSignal
}

/** Probe request: one provider route to test with a fresh request. */
export interface VisionProbeRequest {
  /** Provider route to probe. */
  provider: string
  /** Caller cancellation; adapters must honor it. */
  signal?: AbortSignal
}

/** The provider-side display facts a registered adapter serves. */
export interface VisionProviderDescriptor {
  /** Provider route key used by {@link VisionRequest.provider}. */
  id: string
  /** Human-readable provider name for selectors and diagnostics. */
  displayName: string
  /** One-line description for the directory UI, when the registrant has one. */
  description?: string
}
