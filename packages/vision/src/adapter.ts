/**
 * The vision adapter contract: one implementation per wire family, serving
 * every provider route that speaks it. The adapter is transport-only —
 * connection facts, credentials, endpoint, and protocol live inside the
 * implementation, resolved per call from the provider id; the runtime only
 * routes provider → adapter.
 * @module @ran-sh/dsh-vision/adapter
 */

import type {
  VisionModel, VisionModelDiscoveryRequest, VisionProbeRequest, VisionRequest, VisionResult,
} from './types.ts'

/**
 * A vision adapter. `call` is the only required method; `discoverModels` and
 * `probe` are optional (an adapter family that cannot interrogate endpoints
 * omits them and the runtime reports no discovery).
 */
export abstract class VisionAdapter {
  /**
   * Run one vision request against the provider this adapter serves and read
   * back the text answer. Implementations resolve their own connection facts
   * (endpoint, credential, wire protocol, timeouts) for the provider id and
   * must honor `request.signal`. The runtime guarantees `provider` names a
   * route this adapter is registered for.
   * @param provider - the provider route the runtime selected.
   * @param request - the caller's request (prompt + images + cancellation).
   * @returns the model's text answer plus provider/model identity.
   */
  abstract call(provider: string, request: VisionRequest): Promise<VisionResult>

  /**
   * List models this adapter can discover for one provider route. Optional:
   * an adapter family that cannot interrogate endpoints leaves it
   * unimplemented and the runtime reports no discovery.
   * @param provider - the provider route to interrogate.
   * @param request - caller cancellation; implementations must honor it.
   * @returns discoverable models in adapter-preferred order.
   */
  discoverModels?(provider: string, request?: VisionModelDiscoveryRequest): Promise<readonly VisionModel[]>

  /**
   * Run one probe request against a provider route (a "test connection"
   * probe). Optional; the default dispatch reports no probe.
   * @param provider - the provider route to probe.
   * @param request - the probe request (prompt/images/cancellation).
   * @returns the model's text answer plus provider/model identity.
   */
  probe?(provider: string, request: VisionRequest): Promise<VisionResult>
}

export type {
  VisionModel, VisionModelDiscoveryRequest, VisionProbeRequest, VisionRequest, VisionResult,
} from './types.ts'
