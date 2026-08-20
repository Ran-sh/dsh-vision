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
  id: string
  name?: string
  vision?: boolean
  contextWindow?: number
  maxOutputTokens?: number
  supportsMultipleImages?: boolean
  supportsReasoning?: boolean
}

/** Caller preference for semantic vision-result caching. */
export type VisionCacheMode = 'use' | 'refresh' | 'no-store'

/**
 * Provider-neutral observability for one completed vision operation.
 * Counters describe work, not vendor semantics, so every adapter family can
 * populate them without leaking endpoints, credentials, or protocol details.
 */
export interface VisionTrace {
  /** Number of actual provider HTTP/model calls, including retries. */
  providerCalls: number
  /** UTF-8 bytes across serialized provider request bodies. */
  payloadBytes: number
  /** Semantic-cache hits that avoided a provider call. */
  cacheHits: number
  /** Retry attempts after a failed first wire call. */
  retries: number
  /** Alternate models attempted on the same provider. */
  modelFallbacks: number
  /** Alternate configured provider routes attempted. */
  providerFallbacks: number
  /** HTTP-413 adaptive split events, including recursive splits. */
  splits: number
}

/** One vision request. */
export interface VisionRequest {
  /** Provider id to use; absent selects the runtime's active provider. */
  provider?: string
  /** Model id override; absent uses the provider's configured default. */
  model?: string
  /** The caller's instruction over the image(s). */
  prompt: string
  /** Loaded image bytes and their sniffed media type. */
  images: LoadedImage[]
  /**
   * Semantic-cache preference. `use` (default) may reuse a fresh hit;
   * `refresh` forces a new endpoint call and replaces the cached answer;
   * `no-store` bypasses both cache reads and writes.
   */
  cache?: VisionCacheMode
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
  /** Optional provider-neutral execution counters for diagnostics/benchmarks. */
  trace?: VisionTrace
}

/** Discovery request: a registered provider route to interrogate. */
export interface VisionModelDiscoveryRequest {
  provider: string
  signal?: AbortSignal
}

/** Probe request: one provider route to test with a fresh request. */
export interface VisionProbeRequest {
  provider: string
  signal?: AbortSignal
}

/** The provider-side display facts a registered adapter serves. */
export interface VisionProviderDescriptor {
  id: string
  displayName: string
  description?: string
}
