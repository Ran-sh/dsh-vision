/**
 * Vision runtime barrel. This is the Service Definition for the vision
 * capability seam: the package OWNS `ctx.vision`.
 */

export { VisionRuntime } from './runtime.ts'
export type { VisionAdapterRegistration, VisionDirectoryRegistration } from './runtime.ts'
export { VisionAdapter } from './adapter.ts'
export { VisionError, isVisionError, deepFreeze } from './errors.ts'
export type { VisionErrorCode } from './errors.ts'
export { createVisionProviderHealth, scoreVisionProviderHealth, shouldOpenVisionCircuit, openVisionCircuit } from './health.ts'
export type { VisionProviderHealthSnapshot, VisionProviderHealthScore } from './health.ts'
export { createVisionCircuitBreaker } from './circuit-breaker.ts'
export type { VisionCircuitState, VisionCircuitSnapshot, VisionCircuitPolicy, VisionCircuitBreaker } from './circuit-breaker.ts'
export { inferVisionTask, routeVisionTask } from './task-router.ts'
export type { VisionTask, VisionQualityPolicy, VisionTaskRoute } from './task-router.ts'
export { createMemoryVisionCache, createVisionAnswerKey, createVisionUnderstandingKey, normalizeVisionCacheText } from './cache.ts'
export type { VisionUnderstanding, VisionAnswerCacheEntry, VisionCacheLayerMode, VisionCacheStore, MemoryVisionCacheOptions } from './cache.ts'
export { createVisionTokenBudget } from './token-budget.ts'
export type { VisionTokenBudget } from './token-budget.ts'
export { selectVisionProvider } from './selector.ts'
export type {
  VisionSelectionCandidate,
  VisionSelectionSkipReason,
  VisionRankedCandidate,
  VisionSkippedCandidate,
  VisionSelectionResult,
} from './selector.ts'
export type { VisionModel, VisionModelDiscoveryRequest, VisionProbeRequest, VisionProviderDescriptor, VisionRequest, VisionResult, VisionTrace, LoadedImage, VisionImageMimeType, VisionCacheMode } from './types.ts'
export { VisionRuntime as default } from './runtime.ts'
