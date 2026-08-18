/**
 * The vision runtime: an adapter registry plus a provider directory plus a
 * model-call API, mirroring the harness LLM runtime's shape without importing
 * LLM business semantics. Vision providers are NOT registered into
 * `ctx.llm` — a vision model is a perception backend for text-only models,
 * never a main-session model — so this is an independent `ctx.vision` service.
 *
 * Provider lifecycle mirrors the official `LlmRuntime`:
 * - `registerAdapter(providers, adapter, resolveConnection)` owns a route set
 *   that can be atomically replaced (`handle.replace`, including `replace([])`)
 *   or released by the disposer / fiber teardown; a disposed registration
 *   refuses further `replace` with `REGISTRATION_DISPOSED`.
 * - `registerConfigurableProviders` owns a directory entry set through a
 *   `DirectoryRegistrationHandle` (register / replace / dispose), so a
 *   settings change atomically syncs the directory without stranding entries.
 * - every commit publishes `vision/adapters-updated`; a broken listener is
 *   contained and can never veto the commit.
 *
 * Each call captures an immutable, deep-frozen connection snapshot from the
 * route's connection resolver, so an in-flight request never observes a
 * settings change and the next call re-resolves.
 * @module dsh-plugin-image-mind/runtime/runtime
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { VisionAdapter } from './adapter.ts'
import { VisionError } from './errors.ts'
import { deepFreeze } from './deep-freeze.ts'
import type {
  VisionConnection, VisionConnectionResolver, VisionDiscoveryRequest, VisionDraftConnection,
  VisionModel, VisionProviderDescriptor, VisionRequest, VisionResult,
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
   * adapter instance and connection resolver. Validated in full first — a
   * conflict with another adapter, an invalid name, or bad provider metadata
   * throws and leaves the current routes untouched — and the swap is one
   * synchronous section, so no request can observe a gap. An empty array is
   * legal here (a settings section that emptied holds zero routes while
   * staying registered), unlike an empty initial registration.
   *
   * Throws `VisionError` with code `REGISTRATION_DISPOSED` once the
   * registration has been released.
   * @param providers - the complete next route set for this registration.
   */
  replace(providers: string[]): void
}

/**
 * A live configurable-provider registration, disposable and atomically
 * replaceable — the directory counterpart of {@link VisionAdapterRegistration}.
 */
export interface VisionDirectoryRegistration {
  /** Withdraw every entry this registration currently holds. */
  (): void
  /**
   * Replace this registration's entries with `entries`. The candidate set is
   * validated in full first — an entry another registration already declares,
   * a duplicate within the set, or invalid metadata throws and leaves the
   * current entries untouched — and the swap is one synchronous section, so no
   * reader observes a gap. An empty array is legal here, unlike an empty
   * initial registration.
   *
   * Throws `VisionError` with code `REGISTRATION_DISPOSED` once disposed.
   */
  replace(entries: readonly VisionProviderDescriptor[]): void
}

/** One registered route: adapter + per-call connection resolver. */
interface VisionRoute {
  adapter: VisionAdapter
  resolveConnection: VisionConnectionResolver
  /** Whether the route set still stands; cleared by the registration disposer. */
  active: boolean
}

/** Runtime construction options: the provider-neutral default-provider seam. */
export interface VisionRuntimeOptions {
  /**
   * Resolve the configured active provider id. The decision belongs to the
   * runtime, not to callers: when a request names no provider, the runtime
   * asks this seam for the default before falling back to a single live
   * route. Absent, no default is declared and only the single-route fallback
   * (or an explicit request) selects a provider.
   */
  resolveDefaultProvider?: () => string | undefined
}

/**
 * The `vision` service: an adapter registry plus a provider directory.
 * One instance is created per plugin mount and registered on `ctx.vision`.
 */
export class VisionRuntime extends Service {
  private readonly adapters = new Map<string, VisionRoute>()
  private readonly directory = new Map<string, VisionProviderDescriptor>()
  private readonly resolveDefaultProvider: (() => string | undefined) | undefined

  constructor(ctx: Context, options?: VisionRuntimeOptions) {
    super(ctx, 'vision')
    this.resolveDefaultProvider = options?.resolveDefaultProvider
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
   * Register an adapter for the given provider routes, each resolving its
   * connection facts through `resolveConnection`. Throws `VisionError` with
   * code `DUPLICATE_ADAPTER` if any provider already has an adapter, or
   * `INVALID_ADAPTER` for an empty route list (all-or-nothing). Disposed with
   * the fiber.
   * @param providers - every provider route this adapter should serve.
   * @param adapter - the adapter that serves those providers.
   * @param resolveConnection - per-call connection resolver for those routes.
   * @returns the disposer, carrying atomic route replacement.
   */
  registerAdapter(
    providers: string[],
    adapter: VisionAdapter,
    resolveConnection: VisionConnectionResolver = defaultConnectionResolver,
  ): VisionAdapterRegistration {
    if (providers.length === 0) {
      throw new VisionError('an adapter must register at least one provider', 'INVALID_ADAPTER')
    }
    this.prepareRoutes(providers, adapter, new Set())
    const routes = new Map<string, VisionRoute>()
    for (const provider of providers) {
      routes.set(provider, { adapter, resolveConnection, active: true })
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
          const route = { adapter, resolveConnection, active: true }
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
   * all-or-nothing — an empty list, invalid entry, or a provider already
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
        `image-mind: provider "${descriptor.id}" is already in the directory`,
        'DUPLICATE_PROVIDER',
      )
    }
    this.directory.set(descriptor.id, descriptor)
    this.emitAdaptersUpdated()
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
   * Select the provider one call uses, in order:
   * 1. an explicit `request.provider` id;
   * 2. the configured active provider (`resolveDefaultProvider`), validated
   *    to have a live route;
   * 3. the single live route when exactly one is registered;
   * 4. otherwise `PROVIDER_NOT_FOUND`.
   * The default-provider decision is runtime-owned — callers never read the
   * active configuration themselves.
   */
  private resolveProviderId(requested: string | undefined): string {
    if (requested !== undefined && requested.trim().length > 0) {
      const id = requested.trim()
      this.route(id)
      return id
    }
    const configured = this.resolveDefaultProvider?.()
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
        'image-mind: no active vision provider configured; add one in 设置 → 插件 → 插件配置 → 图像理解',
        'PROVIDER_NOT_FOUND',
      )
    }
    throw new VisionError(
      'image-mind: no provider selected and multiple are configured; pass a provider id or set active',
      'PROVIDER_NOT_FOUND',
    )
  }

  /** The live route for one provider id. */
  private route(provider: string): VisionRoute {
    const route = this.adapters.get(provider)
    if (route === undefined || !route.active) {
      throw new VisionError(
        `image-mind: provider "${provider}" is not registered; add it in 设置 → 插件 → 插件配置 → 图像理解`,
        'PROVIDER_NOT_FOUND',
      )
    }
    return route
  }

  /**
   * Interrogate one provider endpoint for the models it advertises. The
   * request names a registered provider route, or a draft connection a
   * configuration surface is still editing; the runtime resolves the
   * connection facts and the credential internally.
   * @param request - provider route or draft connection to interrogate.
   * @returns the advertised models.
   */
  async discoverModels(request: VisionDiscoveryRequest): Promise<VisionModel[]> {
    const provider = request.provider
    if (provider !== undefined && provider.trim().length > 0) {
      const id = provider.trim()
      const route = this.route(id)
      if (route.adapter.discoverModels === undefined) return []
      // The resolver must see the SAME provider id the route was selected by,
      // so a discovery for 'b' never resolves 'a''s connection facts.
      const connection = await route.resolveConnection({ provider: id, prompt: '', images: [] })
      return route.adapter.discoverModels(deepFreeze(connection))
    }
    if (request.draft === undefined) {
      throw new VisionError('model discovery needs a provider route or a draft connection', 'INVALID_PROVIDER')
    }
    // A draft has no registered route, so no adapter family is known; the
    // registered adapter for the namespace's active route serves the probe.
    const draft = request.draft
    if (draft.baseURL === undefined || draft.baseURL.length === 0) {
      throw new VisionError('model discovery needs a baseURL in the draft connection', 'INVALID_PROVIDER')
    }
    const active = this.resolveProviderId(undefined)
    const route = this.route(active)
    if (route.adapter.discoverModels === undefined) return []
    const connection = await resolveDraftConnection(active, draft)
    return route.adapter.discoverModels(deepFreeze(connection))
  }

  /**
   * Run one vision request. The runtime selects the provider in order:
   * an explicit `request.provider` id, else the configured active provider
   * (via the `resolveDefaultProvider` seam, validated to have a live route),
   * else the single live route when exactly one is registered, else
   * `PROVIDER_NOT_FOUND`. It then looks up the registered route, captures an
   * immutable connection snapshot from the route's resolver, and dispatches
   * to the adapter. Callers never construct a `VisionConnection` themselves.
   * @param request - the caller's request (provider/prompt/images/signal).
   * @returns the model's text answer.
   */
  async call(request: VisionRequest): Promise<VisionResult> {
    const provider = this.resolveProviderId(request.provider)
    const route = this.route(provider)
    const connection = deepFreeze(await route.resolveConnection({ ...request, provider }))
    return route.adapter.call(request, connection)
  }

  /**
   * Run one vision request against a draft connection a configuration surface
   * is still editing (a "test connection" probe). The draft may name a key
   * typed but not yet stored; the runtime builds an immutable snapshot and
   * dispatches through the adapter serving the active provider route (the
   * family the deployment actually uses). The key never crosses to the
   * browser.
   * @param request - the probe request (prompt/images/signal).
   * @param draft - draft connection facts (endpoint + optional key).
   * @returns the model's text answer.
   */
  async probe(request: VisionRequest, draft: VisionDraftConnection): Promise<VisionResult> {
    const provider = this.resolveProviderId(undefined)
    const route = this.route(provider)
    const connection = deepFreeze(resolveDraftConnection(provider, draft))
    return route.adapter.call(request, connection)
  }
}

/** The default connection resolver: refuse a call with no route-provided facts. */
function defaultConnectionResolver(_request: VisionRequest): VisionConnection {
  throw new VisionError(
    'image-mind: provider route has no connection resolver; register one with the adapter',
    'INVALID_ADAPTER',
  )
}

/** Build an immutable connection snapshot from a draft. */
export function resolveDraftConnection(provider: string, draft: VisionDraftConnectionLike): VisionConnection {
  const { baseURL, model, apiStyle, apiKeyEnv, apiKey, timeoutMs, maxOutputTokens } = draft
  return {
    provider,
    baseURL: baseURL ?? '',
    model: model ?? '',
    apiStyle: apiStyle ?? 'chat-completions',
    maxOutputTokens: maxOutputTokens ?? 1024,
    timeoutMs: timeoutMs ?? 60_000,
    ...apiKeyEnv === undefined || apiKeyEnv.length === 0 ? {} : { apiKeyEnv },
    ...apiKey === undefined || apiKey.length === 0 ? {} : { inlineApiKey: apiKey },
  }
}

/** The draft fields a connection snapshot needs (subset of {@link VisionDraftConnection}). */
interface VisionDraftConnectionLike {
  baseURL?: string
  model?: string
  apiStyle?: 'chat-completions' | 'responses'
  apiKeyEnv?: string
  apiKey?: string
  timeoutMs?: number
  maxOutputTokens?: number
}
