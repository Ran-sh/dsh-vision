/**
 * Vision runtime barrel. This is the Service Definition for the vision
 * capability seam: the package OWNS `ctx.vision`. The default export is the
 * `VisionRuntime` service class, so a Cordis composition loads this package
 * as a service plugin entry (`- name: '@ran-sh/dsh-vision'`) and provider
 * plugins inject `['vision']` and register into it — exactly as
 * `@deepseek-ai/dsh-llm` default-exports `LlmRuntime` and
 * `@deepseek-ai/dsh-llm-deepseek` injects `['llm']`.
 * @module @ran-sh/dsh-vision
 */

export { VisionRuntime } from './runtime.ts'
export type { VisionAdapterRegistration, VisionDirectoryRegistration } from './runtime.ts'
export { VisionAdapter } from './adapter.ts'
export { VisionError, isVisionError, deepFreeze } from './errors.ts'
export type { VisionErrorCode } from './errors.ts'
export {
  createVisionProviderHealth,
  scoreVisionProviderHealth,
  shouldOpenVisionCircuit,
  openVisionCircuit,
} from './health.ts'
export type { VisionProviderHealthSnapshot, VisionProviderHealthScore } from './health.ts'
export {
  createVisionCircuitBreaker,
} from './circuit-breaker.ts'
export type {
  VisionCircuitState,
  VisionCircuitSnapshot,
  VisionCircuitPolicy,
  VisionCircuitBreaker,
} from './circuit-breaker.ts'
export type {
  VisionModel, VisionModelDiscoveryRequest, VisionProbeRequest, VisionProviderDescriptor,
  VisionRequest, VisionResult, VisionTrace, LoadedImage, VisionImageMimeType, VisionCacheMode,
} from './types.ts'
export { VisionRuntime as default } from './runtime.ts'
