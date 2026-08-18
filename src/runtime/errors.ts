/**
 * Typed vision failures: a stable machine-routable code plus optional HTTP
 * status, mirroring the harness `LlmError` taxonomy without importing LLM
 * business semantics. Tool results and the settings card route on `code`,
 * never by parsing `message`.
 * @module dsh-plugin-image-mind/runtime/errors
 */

/** Stable provider-neutral failure classes for one vision request. */
export type VisionErrorCode =
  | 'MISSING_CREDENTIAL'
  | 'INVALID_CREDENTIAL'
  | 'PROVIDER_NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'UNSUPPORTED_PROTOCOL'
  | 'IMAGE_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'EMPTY_RESPONSE'
  | 'INVALID_RESPONSE'

/** Whether a failure class is worth an automatic retry (transient). */
const RETRYABLE_CODES: ReadonlySet<VisionErrorCode> = new Set<VisionErrorCode>([
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
])

/** A failure class that automatic retry may repeat. */
export function isRetryableVisionCode(code: VisionErrorCode): boolean {
  return RETRYABLE_CODES.has(code)
}

/**
 * Typed error for one vision operation. Carries the stable {@link code} and
 * optional HTTP status observed at the provider boundary; `retryable` is the
 * policy decision the adapter's retry loop reads.
 */
export class VisionError extends Error {
  /** Stable machine-routable failure class. */
  readonly code: VisionErrorCode
  /** HTTP status observed at the provider boundary, when available. */
  readonly status?: number
  /** Whether automatic retry may repeat this failure. */
  readonly retryable: boolean

  /**
   * @param message - human-readable failure summary.
   * @param code - stable provider-neutral machine code.
   * @param options - optional status and chained cause.
   */
  constructor(message: string, code: VisionErrorCode, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'VisionError'
    this.code = code
    this.status = options?.status
    this.retryable = isRetryableVisionCode(code)
  }
}

/** Narrow an unknown thrown value to a `VisionError`. */
export function isVisionError(value: unknown): value is VisionError {
  return value instanceof VisionError
}

/**
 * Classify a non-2xx HTTP status into a stable code. 401/403 are auth
 * failures; 429 is rate-limited; 5xx are provider errors; everything else is
 * a provider error carrying the exact status.
 * @param status - HTTP status of a non-2xx provider response.
 * @returns the normalized failure class.
 */
export function visionCodeForStatus(status: number): VisionErrorCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'PROVIDER_ERROR'
  return 'PROVIDER_ERROR'
}
