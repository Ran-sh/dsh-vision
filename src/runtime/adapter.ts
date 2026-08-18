/**
 * The vision adapter contract: one implementation per wire family, serving
 * every provider route that speaks it. The adapter is transport-only —
 * connection facts arrive through an immutable {@link VisionConnection} and
 * the bearer token through a resolver, so the registering runtime owns
 * validation, layering, and credential policy.
 * @module dsh-plugin-image-mind/runtime/adapter
 */

import type {
  VisionConnection, VisionDraftConnection, VisionModel, VisionRequest, VisionResult,
} from './types.ts'

/** How the runtime resolves the bearer token for one connection snapshot. */
export type VisionApiKeyResolver = (connection: VisionConnection) => Promise<string>

/**
 * A vision adapter. `call` is the only required method; `discoverModels` is
 * optional (an adapter family that cannot interrogate endpoints omits it and
 * the runtime reports no discovery).
 */
export abstract class VisionAdapter {
  /**
   * Run one vision request against the connection and read back the text
   * answer. Implementations must honor `request.signal` and resolve the
   * bearer through the supplied resolver.
   * @param request - the caller's request (prompt + images + cancellation).
   * @param connection - immutable connection facts for this one call.
   * @returns the model's text answer plus provider/model identity.
   */
  abstract call(request: VisionRequest, connection: VisionConnection): Promise<VisionResult>

  /**
   * List models this adapter can discover for one draft connection. Optional:
   * an adapter family that cannot interrogate endpoints leaves it unimplemented.
   * @param connection - immutable connection facts (endpoint + key seam).
   * @param signal - caller cancellation.
   * @returns discoverable models in adapter-preferred order.
   */
  discoverModels?(connection: VisionConnection, signal?: AbortSignal): Promise<VisionModel[]>
}

export type { VisionConnection, VisionDraftConnection, VisionModel, VisionRequest, VisionResult }
