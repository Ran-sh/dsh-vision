/**
 * Model-facing image understanding for text-only models. Each call loads one
 * image —a local file path, an http(s) URL, an attachment reference JSON, or
 * the bare attachment id from a pasted markdown reference —and asks a
 * vision-language model at an OpenAI-compatible endpoint to answer over it;
 * only the returned text crosses into the conversation, so the image never
 * enters the session log.
 *
 * This entry is composition only: it registers the provider directory and the
 * OpenAI-compatible adapter (with its own per-call provider-option and
 * credential resolution) into the injected `ctx.vision`, installs the
 * settings section, registers the thin `understand_image` tool, and mounts
 * the attachment routes. Provider selection, HTTP, credential parsing, and
 * configuration validation live in their own layers. The vision service
 * package owns `ctx.vision`; this plugin only registers into it.
 *
 * Configuration resolution follows the official llm-deepseek last-good
 * pattern: a static composition error fails loud at load; a live settings
 * snapshot that fails beyond the schema keeps serving the last good snapshot
 * (logged once per bad snapshot) and recovers when the settings turn good.
 *
 * Personal plugin, written from scratch: plugin id `image-mind`, tool name
 * `understand_image`, route prefix /image-mind.
 * @module dsh-plugin-image-mind
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
// Type-only: the `ctx.vision` Context augmentation comes from the vision
// service package. The runtime instance itself is injected through the
// 'vision' service key —this plugin never constructs it.
import type {} from '@ran-sh/dsh-vision'
import { VisionError } from '@ran-sh/dsh-vision'
import type { VisionRequest } from '@ran-sh/dsh-vision'
import { OpenAICompatibleVisionAdapter } from './adapters/openai-compatible/index.ts'
import type { OpenAICompatibleVisionOptions } from './adapters/openai-compatible/types.ts'
import { resolveApiKey } from './credentials/resolve.ts'
import { Config, IMAGE_MIND_SETTINGS_NAMESPACE, resolveConfig, type Config as ConfigType, type ResolvedConfig } from './config.ts'
import { understandImageTool } from './tools/understand-image.ts'
import { migrateLegacyInlineKeys } from './credentials/migrate.ts'
import { registerAttachRoute } from './attachments/routes.ts'
import { readConfigView, writeConfigView } from './attachments/legacy-config.ts'
import { runConnectionTest, listEndpointModels } from './runtime/vision-rpc.ts'
import { VISION_PROVIDER_CATALOG } from './providers/catalog.ts'
import { createVisionCache } from './cache/vision-cache.ts'
import { DEFAULT_MAX_BYTES } from './media/types.ts'

export const name = 'image-mind'
// 'vision' and 'tools' are hard dependencies (injected); 'webServer' is
// optional and probed per call via ctx.get (the attach route degrades
// gracefully on headless mounts).
export const inject = ['vision', 'tools']

// Host-side exports the built artifact keeps: the connection-test RPC (the
// settings card reaches it through the routes; direct callers and the
// built-artifact verification use the same functions) and the embedded
// visual-challenge fixtures.
export { runConnectionTest, listEndpointModels } from './runtime/vision-rpc.ts'
export { VISUAL_FIXTURES, answerMatches } from './runtime/visual-fixtures.ts'

/**
 * Register the vision capability: adapter, directory, settings, tool, routes.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: ConfigType = {}): void {
  // The loader fills schema defaults before apply, so an unconfigured entry
  // still arrives with default fields set. Only a config that actually names
  // a provider or active is validated eagerly —an unconfigured mount loads
  // silently and the first call fails with a clear "no active provider".
  const configHasProviders = config.providers !== undefined && Object.keys(config.providers).length > 0
  if (configHasProviders || config.active !== undefined) {
    resolveConfig(config)
  }
  let current: () => ConfigType = () => config
  // Official last-good pattern: a live settings snapshot that fails beyond
  // the schema keeps serving the last good snapshot (logged once per bad
  // snapshot) and recovers when the settings turn good. A static composition
  // error has no last good yet, so it fails loud at load.
  let lastRaw: ConfigType | undefined
  let lastGood: ResolvedConfig | undefined
  const resolved = (): ResolvedConfig => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveConfig(raw)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('image-mind: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  resolved()

  // The vision service is injected (inject: ['vision']): the @ran-sh/dsh-vision
  // package owns ctx.vision, this plugin only registers into it —exactly as
  // llm-deepseek injects ['llm'] and registers into ctx.llm. The
  // default-provider decision is runtime-owned, but the ACTIVE provider is
  // this plugin's configuration, so the plugin registers the resolver on the
  // injected runtime under its own owner id; the tool stays thin and never
  // reads `active` itself. The registration handle doubles as the fiber
  // disposer: unloading the plugin withdraws the strategy, so no stale
  // resolver can outlive its owner.
  ctx.vision.registerDefaultProviderResolver('image-mind', () => resolved().active)
  // Short-lived semantic cache scoped to this mount: identical provider +
  // model + image + prompt within the TTL reuse the prior answer.
  const cache = createVisionCache()
  // The adapter owns every provider fact: it resolves the current immutable
  // endpoint snapshot per call from the last-good configuration (the request's
  // model override rides along so the snapshot carries it) and the bearer key
  // from the same snapshot —the endpoint and the secret sent to it can never
  // come from different configuration generations. The runtime never sees a
  // baseURL, protocol style, or credential reference.
  const adapter = new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: (provider, request) => connectionSnapshotOf(resolved(), provider, request),
    resolveApiKey: options => resolveApiKey(ctx, options),
    cache,
  })

  // The adapter registration follows the settings section: a section change
  // atomically replaces the route set (including `replace([])` when the user
  // removes every provider), so no request observes a gap and stale routes
  // never survive. An EMPTY initial route set registers nothing —the runtime
  // (like the official LlmRuntime) forbids `registerAdapter([])` —and the
  // first call fails with a clear PROVIDER_NOT_FOUND; once a registration
  // exists, `replace([])` remains legal.
  let registration: ReturnType<typeof ctx.vision.registerAdapter> | undefined
  let registeredRoutes: string[] | undefined
  const ensureRegistration = (): void => {
    const routes = Object.keys(resolved().providers)
    if (registration !== undefined && registeredRoutes !== undefined
      && routes.length === registeredRoutes.length && routes.every((route, index) => route === registeredRoutes![index])) {
      return
    }
    if (registration === undefined) {
      if (routes.length === 0) {
        // Startup with zero providers: stay dormant, no empty registration.
        registeredRoutes = routes
        return
      }
      registration = ctx.vision.registerAdapter(routes, adapter)
    } else {
      // A live registration replaces atomically; `replace([])` is legal.
      registration.replace(routes)
    }
    registeredRoutes = routes
  }
  ensureRegistration()

  // The provider directory: one registration owns every catalog entry
  // (advisory "what can be configured"), a second owns ONLY the user-created
  // providers whose ids are absent from the catalog —a catalog provider the
  // user configures is not re-declared (that would violate registration
  // ownership). Like the adapter registration, an empty initial user set
  // registers nothing and `replace([])` stays legal once live. Directory
  // entries carry display metadata only —endpoint, protocol, and credential
  // facts live in the adapter's own resolution, never in the directory.
  const catalogIds = new Set(VISION_PROVIDER_CATALOG.map(entry => entry.id))
  const catalogDirectory = ctx.vision.registerConfigurableProviders(
    VISION_PROVIDER_CATALOG.map(entry => ({
      id: entry.id,
      displayName: entry.name,
      description: `${entry.baseURL} · ${entry.defaultModel}`,
    })),
  )
  let userDirectory: ReturnType<typeof ctx.vision.registerConfigurableProviders> | undefined
  let registeredUserEntries: string[] | undefined
  const ensureDirectory = (): void => {
    const entries = Object.keys(resolved().providers)
      .filter(id => !catalogIds.has(id))
      .map(id => ({ id, displayName: id }))
    const ids = entries.map(entry => entry.id)
    if (userDirectory !== undefined && registeredUserEntries !== undefined
      && ids.length === registeredUserEntries.length && ids.every((id, index) => id === registeredUserEntries![index])) {
      return
    }
    if (userDirectory === undefined) {
      if (entries.length === 0) {
        // Startup with no custom providers: stay dormant, no empty registration.
        registeredUserEntries = ids
        return
      }
      userDirectory = ctx.vision.registerConfigurableProviders(entries)
    } else {
      // A live directory replaces atomically; `replace([])` is legal.
      userDirectory.replace(entries)
    }
    registeredUserEntries = ids
  }
  ensureDirectory()

  installSettingsSection(ctx, IMAGE_MIND_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // A section change re-resolves (last-good keeps the previous snapshot
      // on a bad one) and atomically re-registers the route + directory sets.
      try {
        resolved()
        ensureRegistration()
        ensureDirectory()
      } catch (error) {
        ctx.logger.error('image-mind: keeping the previously registered vision routes after a refused settings update')
        ctx.logger.error(error)
      }
    },
    validate: (value) => {
      const hasProviders = value.providers !== undefined && Object.keys(value.providers).length > 0
      if (hasProviders || value.active !== undefined) resolveConfig(value)
    },
  })

  // Legacy inline apiKey migration: move any stored `providers.<id>.apiKey`
  // into the credential store and clear the inline field (idempotent,
  // best-effort, never drops the user's configuration). Runs once against the
  // stored section; the settings card never creates inline keys.
  void migrateLegacyInlineKeys(ctx, current().providers)

  // The thin tool: it only loads the image and hands the request to ctx.vision.
  ctx.tools.register(understandImageTool(
    ctx,
    () => resolved().defaultPrompt,
    () => ({ maxBytes: resolved().maxBytes, allowPrivateNetwork: resolved().allowPrivateNetwork }),
  ))

  // Attachment routes + thin vision RPC; the legacy /image-mind/config
  // gateway stays as a compatibility transport.
  registerAttachRoute(ctx, {
    readMaxBytes: () => current().maxBytes ?? DEFAULT_MAX_BYTES,
    readConfigView: () => readConfigView(ctx),
    writeConfigView: (body) => writeConfigView(ctx, body),
    runConnectionTest: (body) => runConnectionTest(ctx, body as Parameters<typeof runConnectionTest>[1]),
    listEndpointModels: (body) => listEndpointModels(ctx, body as Parameters<typeof listEndpointModels>[1]),
    catalog: () => VISION_PROVIDER_CATALOG,
  })
}

/**
 * Build the endpoint snapshot one call holds: the named provider's resolved
 * facts, plus the request's model override. The adapter deep-freezes the
 * snapshot before the wire layer sees it, so an in-flight request never
 * observes a settings change and the next call re-resolves.
 * @param resolved - the current last-good resolved configuration.
 * @param requested - the provider id the runtime already selected (always
 *   present on the dispatch path; kept optional for direct callers).
 * @param request - the caller's request; a non-empty `model` override wins
 *   over the provider's configured default. Never mutates the provider's own
 *   configuration.
 */
function connectionSnapshotOf(
  resolved: ResolvedConfig,
  requested?: string,
  request?: VisionRequest,
): OpenAICompatibleVisionOptions {
  const ids = Object.keys(resolved.providers)
  const requestedId = requested !== undefined && requested.trim().length > 0 ? requested.trim() : undefined
  const id = requestedId ?? resolved.active ?? (ids.length === 1 ? ids[0] : undefined)
  if (id === undefined) {
    throw new VisionError(
      'image-mind: no active vision provider configured; configure one in the image-mind settings',
      'PROVIDER_NOT_FOUND',
    )
  }
  const spec = resolved.providers[id]
  if (spec === undefined) {
    throw new VisionError(`image-mind: provider ${JSON.stringify(id)} is not defined`, 'PROVIDER_NOT_FOUND')
  }
  const requestedModel = request?.model
  const modelOverride = requestedModel !== undefined && requestedModel.trim().length > 0 ? requestedModel.trim() : undefined
  const maxOutputTokens = request?.maxOutputTokens ?? spec.maxOutputTokens
  return {
    provider: id,
    baseURL: spec.baseURL,
    model: modelOverride ?? spec.model,
    apiStyle: spec.apiStyle,
    maxOutputTokens,
    timeoutMs: resolved.timeoutMs,
    ...spec.apiKeyEnv === undefined || spec.apiKeyEnv.length === 0 ? {} : { apiKeyEnv: String(spec.apiKeyEnv) },
    // Host-only legacy fallback: a still-unmigrated inline key resolves in
    // the host process, never reaching the browser.
    ...spec.apiKey === undefined || spec.apiKey.length === 0 ? {} : { inlineApiKey: spec.apiKey },
  }
}
