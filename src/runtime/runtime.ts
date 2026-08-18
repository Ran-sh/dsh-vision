/**
 * The vision runtime: an adapter registry plus a provider directory plus a
 * model-call API, mirroring the harness LLM runtime's shape without importing
 * LLM business semantics. Vision providers are NOT registered into
 * `ctx.llm` — a vision model is a perception backend for text-only models,
 * never a main-session model — so this is an independent `ctx.vision` service.
 *
 * Provider lifecycle: registration is atomic and replaceable (a settings
 * change swaps routes in one synchronous section; an in-flight request holds
 * its own immutable connection snapshot, so it never observes the change and
 * the next call re-resolves). Removing a provider rejects new requests
 * immediately while in-flight requests finish naturally.
 * @module dsh-plugin-image-mind/runtime/runtime
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { VisionAdapter } from './adapter.ts'
import { VisionError } from './errors.ts'
import type {
  VisionConnection, VisionModel, VisionProviderDescriptor, VisionRequest, VisionResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    vision: VisionRuntime
  }
}

/** What {@link VisionRuntime.registerAdapter} returns: disposer + atomic replace. */
export interface VisionAdapterRegistration {
  /** Release every route this registration currently holds. */
  (): void
  /**
   * Replace this registration's routes with `providers`, keeping the same
   * adapter instance. Validated in full first; the swap is one synchronous
   * section, so no request can observe a gap.
   */
  replace(providers: string[]): void
}

/** One registered route: the adapter instance serving it. */
interface VisionRoute {
  adapter: VisionAdapter
  /** Whether the route set still stands; cleared by the registration disposer. */
  active: boolean
}

/**
 * The `vision` service: an adapter registry plus a provider directory.
 * One instance is created per plugin mount and registered on `ctx.vision`.
 */
export class VisionRuntime extends Service {
  private readonly adapters = new Map<string, VisionRoute>()
  private readonly directory = new Map<string, VisionProviderDescriptor>()

  constructor(ctx: Context) {
    super(ctx, 'vision')
  }

  /**
   * Register an adapter for the given provider routes. Throws `VisionError`
   * on a duplicate route (all-or-nothing). Disposed with the fiber.
   * @param providers - every provider route this adapter should serve.
   * @param adapter - the adapter that serves those providers.
   * @returns the disposer, carrying atomic route replacement.
   */
  registerAdapter(providers: string[], adapter: VisionAdapter): VisionAdapterRegistration {
    for (const provider of providers) {
      if (this.adapters.has(provider)) {
        throw new VisionError(
          `image-mind: provider route "${provider}" already has an adapter`,
          'PROVIDER_NOT_FOUND',
        )
      }
    }
    const routes = new Map<string, VisionRoute>()
    for (const provider of providers) {
      routes.set(provider, { adapter, active: true })
    }
    const apply = (): void => {
      for (const [provider, route] of routes) this.adapters.set(provider, route)
    }
    const release = (): void => {
      for (const provider of routes.keys()) {
        const current = this.adapters.get(provider)
        if (current?.adapter === adapter) this.adapters.delete(provider)
      }
    }
    apply()
    this.ctx.effect(() => release, `vision.registerAdapter(${JSON.stringify(providers)})`)
    const handle = ((): VisionAdapterRegistration => {
      const disposer = ((): void => {
        release()
        for (const route of routes.values()) route.active = false
      }) as VisionAdapterRegistration
      disposer.replace = (next: string[]): void => {
        for (const provider of next) {
          const existing = this.adapters.get(provider)
          if (existing !== undefined && !routes.has(provider)) {
            throw new VisionError(
              `image-mind: provider route "${provider}" already has an adapter`,
              'PROVIDER_NOT_FOUND',
            )
          }
        }
        // Build the next route set and swap in one synchronous section.
        const nextRoutes = new Map<string, VisionRoute>()
        for (const provider of next) {
          nextRoutes.set(provider, { adapter, active: true })
        }
        // Release routes this registration held that are not in the next set.
        for (const provider of routes.keys()) {
          if (!nextRoutes.has(provider)) this.adapters.delete(provider)
        }
        routes.clear()
        for (const [provider, route] of nextRoutes) {
          routes.set(provider, route)
          this.adapters.set(provider, route)
        }
      }
      return disposer
    })()
    return handle
  }

  /**
   * Declare one provider in the directory. The directory is advisory: it
   * describes what a configuration surface can offer, distinct from the
   * adapter registry that actually serves calls.
   * @param descriptor - provider display metadata.
   */
  registerProvider(descriptor: VisionProviderDescriptor): void {
    if (this.directory.has(descriptor.id)) {
      throw new VisionError(
        `image-mind: provider "${descriptor.id}" is already in the directory`,
        'PROVIDER_NOT_FOUND',
      )
    }
    this.directory.set(descriptor.id, descriptor)
  }

  /** Replace the whole directory atomically. */
  replaceDirectory(descriptors: readonly VisionProviderDescriptor[]): void {
    const next = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]))
    this.directory.clear()
    for (const [id, descriptor] of next) this.directory.set(id, descriptor)
  }

  /** Every registered provider route with its display metadata. */
  listProviders(): VisionProviderDescriptor[] {
    return [...this.adapters.keys()].map(id => this.directory.get(id) ?? {
      id,
      displayName: id,
      adapter: 'unknown',
      apiStyle: 'chat-completions',
    })
  }

  /** One provider route's display metadata, or undefined. */
  getProvider(id: string): VisionProviderDescriptor | undefined {
    return this.directory.get(id)
  }

  /** Every directory entry (registered or dormant). */
  listDirectory(): VisionProviderDescriptor[] {
    return [...this.directory.values()]
  }

  /** Whether one provider route has a live adapter. */
  hasProvider(id: string): boolean {
    return this.adapters.has(id)
  }

  /** The adapter serving one provider route, or undefined. */
  adapterFor(provider: string): VisionAdapter | undefined {
    return this.adapters.get(provider)?.adapter
  }

  /**
   * Interrogate one provider endpoint for the models it advertises. The
   * request describes a draft, not a stored route, so nothing here reads
   * settings — the caller owns both endpoint and credential.
   * @param provider - registered provider route to interrogate.
   * @param connection - immutable connection facts (endpoint + key seam).
   * @param signal - caller cancellation.
   * @returns the advertised models.
   */
  async discoverModels(provider: string, connection: VisionConnection, signal?: AbortSignal): Promise<VisionModel[]> {
    const route = this.adapters.get(provider)
    if (route === undefined || !route.active) {
      throw new VisionError(`image-mind: provider "${provider}" is not registered`, 'PROVIDER_NOT_FOUND')
    }
    if (route.adapter.discoverModels === undefined) {
      return []
    }
    return route.adapter.discoverModels(connection, signal)
  }

  /**
   * Run one vision request through the registered adapter for its provider.
   * @param request - the caller's request (provider/prompt/images/signal).
   * @param connection - immutable connection facts for this one call.
   * @returns the model's text answer.
   */
  async call(request: VisionRequest, connection: VisionConnection): Promise<VisionResult> {
    const route = this.adapters.get(connection.provider)
    if (route === undefined || !route.active) {
      throw new VisionError(
        `image-mind: provider "${connection.provider}" is not registered; add it in 设置 → 插件 → 插件配置 → 图像理解`,
        'PROVIDER_NOT_FOUND',
      )
    }
    return route.adapter.call(request, connection)
  }
}
