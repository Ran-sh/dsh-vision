/**
 * Provider-neutral lifecycle metadata for one routed vision operation.
 *
 * These events are deliberately metadata-only. They never contain the caller
 * prompt, image bytes, image references/paths, endpoint URLs, credentials, or
 * provider response text, so benchmark/debug subscribers cannot accidentally
 * turn observability into a content/secret exfiltration path.
 */

import type { VisionTask } from './task-router.ts'
import type { VisionCacheMode, VisionTrace } from './types.ts'

export interface VisionRequestLifecycleBase {
  /** Process-local id that correlates started/completed/failed events. */
  requestId: string
  /** Provider route selected by the runtime before adapter execution. */
  provider: string
  /** Broad task inferred internally from the caller instruction. */
  task: VisionTask
  /** Number of loaded images; no image identifiers are exposed. */
  imageCount: number
  /** Effective cache intent supplied by the caller. */
  cacheMode: VisionCacheMode
  /** Caller-requested output ceiling, when present. */
  maxOutputTokens?: number
  /** Whether provider/model routing was explicitly pinned by the caller. */
  explicitProvider: boolean
  explicitModel: boolean
  /** Wall-clock start timestamp for correlation. */
  startedAt: number
}

export interface VisionRequestStartedEvent extends VisionRequestLifecycleBase {
  phase: 'started'
}

export interface VisionRequestCompletedEvent extends VisionRequestLifecycleBase {
  phase: 'completed'
  elapsedMs: number
  /** Final provider may differ from the initially routed provider after fallback. */
  resultProvider: string
  model: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  trace?: VisionTrace
}

export interface VisionRequestFailedEvent extends VisionRequestLifecycleBase {
  phase: 'failed'
  elapsedMs: number
  /** Provider-neutral error code/name only; error message/cause are never emitted. */
  errorCode?: string
  aborted: boolean
  trace?: VisionTrace
}

export type VisionRequestLifecycleEvent =
  | VisionRequestStartedEvent
  | VisionRequestCompletedEvent
  | VisionRequestFailedEvent
