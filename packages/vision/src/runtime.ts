/**
 * The vision runtime: an adapter registry plus a provider directory plus a
 * model-call API, mirroring the harness LLM runtime's shape without importing
 * LLM business semantics. Vision providers are NOT registered into
 * `ctx.llm` —a vision model is a perception backend for text-only models,
 * never a main-session model —so this is an independent `ctx.vision` service.
 *
 * The runtime knows only provider ids, adapter instances, requests, and
 * results: every provider fact (endpoint, credential, wire protocol, timeout,
 * retry) lives inside the registered adapter, resolved per call. The runtime
 * routes `provider → adapter` and nothing else, exactly as `ctx.llm` routes
 * `provider → LlmAdapter` and `ctx.web` routes capability → provider.
 *
 * Provider lifecycle mirrors the official `LlmRuntime`:
 * - `registerAdapter(providers, adapter)` owns a route set that can be
 *   atomically replaced (`handle.replace`, including `replace([])`) or
 *   released by the disposer / fiber teardown; a disposed registration
 *   refuses further `replace` with `REGISTRATION_DISPOSED`.
 * - `registerConfigurableProviders` owns a directory entry set through a
 *   `DirectoryRegistrationHandle` (register / replace / dispose), so a
 *   settings change atomically syncs the directory without stranding entries.
 * - `registerDefaultProviderResolver(owner, resolver)` owns the default-
 *   provider strategy: exactly one owner at a time (a second owner throws
 *   `DUPLICATE_DEFAULT_PROVIDER` rather than silently overriding), the
 *   disposer withdraws the strategy, and fiber teardown withdraws it too — a
 *   provider plugin unload can never leave a stale resolver behind.
 * - every topology commit publishes `vision/adapters-updated`; a broken
 *   listener is contained and can never veto the commit.
 * - request lifecycle observers receive metadata-only started/completed/failed
 *   events and are likewise isolated from request execution.
 *
 * This is the Service Definition for the vision capability seam: the package
 * OWNS `ctx.vision`, and provider plugins inject `['vision']` and register
 * adapters/directory entries into it — exactly as `@deepseek-ai/dsh-llm` owns
 * `ctx.llm` and `@deepseek-ai/dsh-llm-deepseek` injects and registers into it.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { VisionAdapter } from './adapter.ts'
import { VisionError } from './errors.ts'
import { inferVisionTask } from './task-router.ts'
import type { VisionLifecycleListener, VisionRequestLifecycleBase } from './events.ts'
import type {
  VisionModel, VisionModelDiscoveryRequest, VisionProviderDescriptor, VisionRequest, VisionResult, VisionTrace,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    vision: VisionRuntime
  }
  interface Events {
    /**
     * The provider topology changed: an adapter registered or unregistered
     * routes, or the directory gained or lost entries. Payload-free; observers
     * re-read `listProviders()` / `listDirectory()`. Listener failures are
     * contained and never veto the registry mutation.
     * @mode emit
     */
    'vision/adapters-updated'(): void
  }
}

/** What {@link VisionRuntime.registerAdapter} returns: disposer + atomic replace. */
export interface VisionAdapterRegistration {
  /** Release every route this registration currently holds. */
  (): void
  /**
   * Replace this registration's routes with `providers`, keeping the same
   * adapter instance. Validated in full first —a conflict with another
   * adapter, an invalid name, or bad provider metadata throws and leaves the
   * current routes untouched —and the swap is one synchronous section, so no
   * request can observe a gap. An empty array is legal here (a settings
   * section that emptied holds zero routes while staying registered), unlike
   * an empty initial registration.
   *
   * Throws `VisionError` with code `REGISTRATION_DISPOSED` once the
   * registration has been released.
   * @param providers - the complete next route set for this registration.
   */
  replace(providers: string[]): void
}

/**
 * A live configurable-provider registration, disposable and atomically
 * replaceable —the directory counterpart of {@link VisionAdapterRegistration}.
 */
export interface VisionDirectoryRegistration {
  /** Withdraw every entry this registration currently holds. */
  (): void
  /**
   * Replace this registration's entries with `entries`. The candidate set is
   * validated in full first —an entry another registration already declares,
   * a duplicate within the set, or invalid metadata throws and leaves the
   * current entries untouched —and the swap is one synchronous section, so no
   * reader observes a gap. An empty array is legal here, unlike an empty
   * initial registration.
   *
   * Throws `VisionError` with code `REGISTRATION_DISPOSED` once disposed.
   */
  replace(entries: readonly VisionProviderDescriptor[]): void
}

/** One registered route: adapter instance + liveness flag. */
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
  private readonly lifecycleListeners = new Set<VisionLifecycleListener>()
  private defaultProvider: { owner: string; resolve: () => string | undefined } | undefined
  private lifecycleSequence = 0

  constructor(ctx: Context) {
    super(ctx, 'vision')
  }

  /**
   * Observe routed request lifecycle metadata. The listener never receives
   * prompt text, image bytes/paths, endpoint URLs, credentials, or response
   * text. Listener failures are contained and cannot fail the vision call.
   */
  subscribeLifecycle(listener: VisionLifecycleListener): () => void {
    this.lifecycleListeners.add(listener)
    return () => { this.lifecycleListeners.delete(listener) }
  }

  /** Fire-and-contain one metadata-only lifecycle event. */
  private emitLifecycle(event: Parameters<VisionLifecycleListener>[0]): void {
    for (const listener of [...this.lifecycleListeners]) {
      try {
        const returned = listener(event)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnLifecycleListenerFailure(error)
          })
        }
      } catch (error) {
        this.warnLifecycleListenerFailure(error)
      }
    }
  }

  private warnLifecycleListenerFailure(error: unknown): void {
    this.ctx.logger.warn('vision: a request lifecycle listener failed')
    this.ctx.logger.warn(error)
  }

  /**
   * Register the default-provider strategy for one owner. The configured
   * active provider is provider-side configuration, so the plugin that owns
   * that setting registers the resolver here; the runtime only consults it
   * when a request names no provider. Exactly one owner may hold the
   * strategy: a second owner throws `DUPLICATE_DEFAULT_PROVIDER` instead of
   * silently overriding the first. The same owner re-registering replaces
   * its own strategy (a plugin reload re-registers after its fiber disposed
   * the old one).
   * @param owner - stable identity of the registering provider plugin.
   * @param resolve - resolves the configured active provider id.
   * @returns the disposer that withdraws this strategy.
   */
  registerDefaultProviderResolver(owner: string, resolve: () => string | undefined): () => void {
    if (this.defaultProvider !== undefined && this.defaultProvider.owner !== owner) {
      throw new VisionError(
        `a default-provider resolver is already registered by "${this.defaultProvider.owner}"`,
        'DUPLICATE_DEFAULT_PROVIDER',
      )
    }
    this.defaultProvider = { owner, resolve }
    this.ctx.effect(() => () => {
      if (this.defaultProvider?.owner === owner) this.defaultProvider = undefined
    }, `vision.registerDefaultProviderResolver(${JSON.stringify(owner)})`)
    return () => {
      if (this.defaultProvider?.owner === owner) this.defaultProvider = undefined
    }
  }

  /** Notify topology observers without letting one broken listener veto the commit. */
  private emitAdaptersUpdated(): void {
    let invariantFailure: unknown
    const args = ['vision/adapters-updated']
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<() => unknown>) {
      try {
        const returned = listener()
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnListenerFailure(error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.warnListenerFailure(error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }

  /** Contained-listener diagnostic shared by both failure paths. */
  private warnListenerFailure(error: unknown): void {
    this.ctx.logger.warn('vision: a vision/adapters-updated listener failed')
    this.ctx.logger.warn(error)
  }

  /**
   * Register an adapter for the given provider routes. Throws `VisionError`
   * with code `DUPLICATE_ADAPTER` if any provider already has an adapter, or
   * `INVALID_ADAPTER` for an empty route list (all-or-nothing). Disposed with
   * the fiber. The adapter owns every provider fact; the runtime only routes
   * provider ids to it.
   * @param providers - every provider route this adapter should serve.
   * @param adapter - the adapter that serves those providers.
   * @returns the disposer, carrying atomic route replacement.
   */
  registerAdapter(providers: string[], adapter: VisionAdapter): VisionAdapterRegistration {
    if (providers.length === 0) {
      throw new VisionError('an adapter must register at least one provider', 'INVALID_ADAPTER')
    }
    this.prepareRoutes(providers, adapter, new Set())
    const routes = new Map<string, VisionRoute>()
    for (const provider of providers) {
      routes.set(provider, { adapter, active: true })
    }
    // `replace([])` is legal and must not look like a released registration.
    let released = false
    const release = (): void => {
      for (const provider of routes.keys()) {
        const current = this.adapters.get(provider)
        if (current?.adapter === adapter) this.adapters.delete(provider)
      }
      for (const route of routes.values()) route.active = false
    }
    for (const [provider, route] of routes) this.adapters.set(provider, route)
    this.emitAdaptersUpdated()
    this.ctx.effect(() => () => {
      released = true
      release()
      this.emitAdaptersUpdated()
    }, `vision.registerAdapter(${JSON.stringify(providers)})`)
    const handle = ((): VisionAdapterRegistration => {
      const disposer = ((): void => {
        // The fiber disposer also runs; guard against double release.
        if (released) return
        released = true
        release()
        this.emitAdaptersUpdated()
      }) as VisionAdapterRegistration
      disposer.replace = (next: string[]): void => {
        if (released) {
          throw new VisionError('a disposed adapter registration cannot replace its routes', 'REGISTRATION_DISPOSED')
        }
        // Validate the candidate set in full before mutating anything.
        this.prepareRoutes(next, adapter, new Set(routes.keys()))
        // Swap in one synchronous section.
        for (const provider of routes.keys()) {
          if (!next.includes(provider)) this.adapters.delete(provider)
        }
        routes.clear()
        for (const provider of next) {
          const route = { adapter, active: true }
          routes.set(provider, route)
          this.adapters.set(provider, route)
        }
        this.emitAdaptersUpdated()
      }
      return disposer
    })()
    return handle
  }

  /**
   * Validate one candidate route set, treating routes this registration
   * already holds as available. Nothing is mutated: a rejected candidate
   * leaves the registry exactly as it was.
   */
  private prepareRoutes(providers: string[], adapter: VisionAdapter, owned: ReadonlySet<string>): void {
    const unique = new Set<string>()
    for (const provider of providers) {
      if (provider.length === 0) {
        throw new VisionError('adapter provider names must be non-empty', 'INVALID_ADAPTER')
      }
      if (unique.has(provider) || (this.adapters.has(provider) && !owned.has(provider))) {
        throw new VisionError(`an adapter for provider "${provider}" is already registered`, 'DUPLICATE_ADAPTER')
      }
      unique.add(provider)
    }
  }

  /**
   * Declare configurable providers in the directory. The directory is
   * advisory: it describes what a configuration surface can offer, distinct
   * from the adapter registry that actually serves calls. Registration is
   * all-or-nothing —an empty list, invalid entry, or a provider already
   * declared by any registration throws without registering the rest.
   * @param entries - every configurable provider this registrant owns.
   * @returns a handle that withdraws all of them, and can atomically replace them.
   */
  registerConfigurableProviders(entries: readonly VisionProviderDescriptor[]): VisionDirectoryRegistration {
    let held: VisionProviderDescriptor[] = []
    let disposed = false
    const commit = (candidates: readonly VisionProviderDescriptor[]): void => {
      const detached: VisionProviderDescriptor[] = []
      const own = new Set(held.map(entry => entry.id))
      for (const entry of candidates) {
        if (entry.id.length === 0 || entry.displayName.length === 0) {
          throw new VisionError('configurable providers need a non-empty id and displayName', 'INVALID_PROVIDER')
        }
        if ((this.directory.has(entry.id) && !own.has(entry.id))
          || detached.some(seen => seen.id === entry.id)) {
          throw new VisionError(`configurable provider "${entry.id}" is already declared`, 'DUPLICATE_PROVIDER')
        }
        detached.push({ ...entry })
      }
      for (const entry of held) this.directory.delete(entry.id)
      for (const entry of detached) this.directory.set(entry.id, entry)
      held = detached
      this.emitAdaptersUpdated()
    }
    if (entries.length === 0) {
      throw new VisionError('a configurable-provider registration must declare at least one provider', 'INVALID_PROVIDER')
    }
    commit(entries)
    this.ctx.effect(() => () => {
      disposed = true
      for (const entry of held) this.directory.delete(entry.id)
      held = []
      this.emitAdaptersUpdated()
    }, 'vision.registerConfigurableProviders()')
    const handle = ((): void => {
      if (!disposed) {
        disposed = true
        for (const entry of held) this.directory.delete(entry.id)
        held = []
        this.emitAdaptersUpdated()
      }
    }) as VisionDirectoryRegistration
    handle.replace = (next: readonly VisionProviderDescriptor[]): void => {
      if (disposed) {
        throw new VisionError('this configurable-provider registration was disposed', 'REGISTRATION_DISPOSED')
      }
      commit(next)
    }
    return handle
  }

  /**
   * Register one standalone directory entry (single-provider convenience;
   * prefer {@link registerConfigurableProviders} for ownership tracking).
   * Throws `VisionError` `DUPLICATE_PROVIDER` on a duplicate id.
   */
  registerProvider(descriptor: VisionProviderDescriptor): void {
    if (this.directory.has(descriptor.id)) {
      throw new VisionError(
        `vision: provider "${descriptor.id}" is already in the directory`,
        'DUPLICATE_PROVIDER',
      )
    }
    this.directory.set(descriptor.id, descriptor)
    this.emitAdaptersUpdated()
  }

  /** Every registered provider route with its display metadata. */
  listProviders(): VisionProviderDescriptor[] {
    return [...this.adapters.keys()].map(id => this.directory.get(id) ?? { id, displayName: id })
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
   * Select the provider one call uses, in order:
   * 1. an explicit `request.provider` id;
   * 2. the default provider (`registerDefaultProviderResolver`), validated
   *    to have a live route;
   * 3. the single live route when exactly one is registered;
   * 4. otherwise `PROVIDER_NOT_FOUND`.
   * The default-provider decision is runtime-owned —callers never read the
   * active configuration themselves.
   */
  private resolveProviderId(requested: string | undefined): string {
    if (requested !== undefined && requested.trim().length > 0) {
      const id = requested.trim()
      this.route(id)
      return id
    }
    const configured = this.defaultProvider?.resolve()
    if (configured !== undefined && configured.trim().length > 0) {
      // The configured active must actually have a live route; a stale active
      // (e.g. deleted provider) is a clear failure, never a silent fallback.
      const id = configured.trim()
      this.route(id)
      return id
    }
    const live = [...this.adapters.keys()]
    if (live.length === 1) return live[0]
    if (live.length === 0) {
      throw new VisionError(
        'vision: no active vision provider configured; register a provider plugin or pass a provider id',
        'PROVIDER_NOT_FOUND',
      )
    }
    throw new VisionError(
      'vision: no provider selected and multiple are configured; pass a provider id or set active',
      'PROVIDER_NOT_FOUND',
    )
  }

  /** The live route for one provider id. */
  private route(provider: string): VisionRoute {
    const route = this.adapters.get(provider)
    if (route === undefined || !route.active) {
      throw new VisionError(
        `vision: provider "${provider}" is not registered; configure it or pass a provider id`,
        'PROVIDER_NOT_FOUND',
      )
    }
    return route
  }

  /**
   * Interrogate one registered provider endpoint for the models it
   * advertises. The provider route selects the adapter, and the adapter
   * resolves its own endpoint/credential/protocol to answer.
   * @param request - provider route to interrogate.
   * @returns the advertised models.
   */
  async discoverModels(request: VisionModelDiscoveryRequest): Promise<readonly VisionModel[]> {
    const provider = request.provider.trim()
    const route = this.route(provider)
    if (route.adapter.discoverModels === undefined) return []
    return route.adapter.discoverModels(provider, request)
  }

  /**
   * Run one vision request. The runtime selects a provider, emits a
   * metadata-only lifecycle start, dispatches to the adapter, then emits a
   * completed/failed event. Observer failures never affect the request.
   */
  async call(request: VisionRequest): Promise<VisionResult> {
    const provider = this.resolveProviderId(request.provider)
    const route = this.route(provider)
    const startedAt = Date.now()
    const requestId = `vision-${++this.lifecycleSequence}`
    const explicitProvider = request.provider !== undefined && request.provider.trim().length > 0
    const explicitModel = request.model !== undefined && request.model.trim().length > 0
    const base = Object.freeze({
      requestId,
      provider,
      task: inferVisionTask(request.prompt, request.images.length),
      imageCount: request.images.length,
      cacheMode: request.cache ?? 'use',
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      explicitProvider,
      explicitModel,
      startedAt,
    }) satisfies VisionRequestLifecycleBase

    this.emitLifecycle(Object.freeze({ ...base, phase: 'started' }))
    try {
      const result = await route.adapter.call(provider, request)
      this.emitLifecycle(Object.freeze({
        ...base,
        phase: 'completed',
        elapsedMs: Math.max(0, Date.now() - startedAt),
        resultProvider: result.provider,
        model: result.model,
        ...(result.usage === undefined ? {} : { usage: Object.freeze({ ...result.usage }) }),
        ...(result.trace === undefined ? {} : { trace: Object.freeze({ ...result.trace }) }),
      }))
      return result
    } catch (error) {
      const trace = (error as { trace?: VisionTrace } | null)?.trace
      const errorCode = typeof (error as { code?: unknown } | null)?.code === 'string'
        ? String((error as { code: string }).code)
        : error instanceof Error
          ? error.name
          : undefined
      const aborted = request.signal?.aborted === true
        || (error instanceof Error && error.name === 'AbortError')
      this.emitLifecycle(Object.freeze({
        ...base,
        phase: 'failed',
        elapsedMs: Math.max(0, Date.now() - startedAt),
        ...(errorCode === undefined ? {} : { errorCode }),
        aborted,
        ...(trace === undefined ? {} : { trace: Object.freeze({ ...trace }) }),
      }))
      throw error
    }
  }

  /**
   * Run one probe request against a registered provider route (a "test
   * connection" probe). The route selects the adapter; an adapter family
   * without a probe path reports `PROVIDER_NOT_FOUND` style failure through
   * `NO_ADAPTER`.
   * @param provider - the provider route to probe.
   * @param request - the probe request (prompt/images/cancellation).
   * @returns the model's text answer.
   */
  async probe(provider: string, request: VisionRequest): Promise<VisionResult> {
    const route = this.route(provider)
    if (route.adapter.probe === undefined) {
      throw new VisionError(`vision: provider "${provider}" has no probe support`, 'NO_ADAPTER')
    }
    return route.adapter.probe(provider, request)
  }
}
