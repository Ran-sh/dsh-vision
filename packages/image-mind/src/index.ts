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
import { createProviderReliabilityTracker } from './runtime/provider-reliability.ts'
import { ReliabilityVisionAdapter } from './runtime/reliability-adapter.ts'
import { VISION_PROVIDER_CATALOG } from './providers/catalog.ts'
import { createVisionCache } from './cache/vision-cache.ts'
import { DEFAULT_MAX_BYTES } from './media/types.ts'

export const name = 'image-mind'
export const inject = ['vision', 'tools']

export { runConnectionTest, listEndpointModels } from './runtime/vision-rpc.ts'
export { VISUAL_FIXTURES, answerMatches } from './runtime/visual-fixtures.ts'

/**
 * Register the vision capability: adapter, directory, settings, tool, routes.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: ConfigType = {}): void {
  const configHasProviders = config.providers !== undefined && Object.keys(config.providers).length > 0
  if (configHasProviders || config.active !== undefined) {
    resolveConfig(config)
  }
  let current: () => ConfigType = () => config
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

  ctx.vision.registerDefaultProviderResolver('image-mind', () => resolved().active)
  const cache = createVisionCache()
  const reliability = createProviderReliabilityTracker()
  const wireAdapter = new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: (provider, request) => connectionSnapshotOf(resolved(), provider, request),
    resolveApiKey: options => resolveApiKey(ctx, options),
    // Cross-provider recovery is provider-plugin policy, not a Runtime route
    // selection rule. Candidates are ranked from current last-good config plus
    // bounded in-memory health/circuit state; settings changes take effect on
    // the very next exhausted call.
    resolveProviderFallbacks: (provider, request) => reliability.fallbacks(resolved(), provider, request),
    cache,
  })
  // The decorator observes provider-level outcomes without touching transport
  // logic. Retry/model fallback/cache remain owned by the wire adapter.
  const adapter = new ReliabilityVisionAdapter(wireAdapter, reliability)

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
        registeredRoutes = routes
        return
      }
      registration = ctx.vision.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredRoutes = routes
  }
  ensureRegistration()

  // The provider directory: one registration owns every catalog entry
  // (advisory "what can be configured"), a second owns ONLY the user-created
  // providers whose ids are absent from the catalog —a catalog provider the
  // user configures is not re-declared (that would violate registration
  // ownership). Directory entries carry display metadata only —endpoint,
  // protocol, and credential facts live in the adapter's own resolution.
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
        registeredUserEntries = ids
        return
      }
      userDirectory = ctx.vision.registerConfigurableProviders(entries)
    } else {
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

  void migrateLegacyInlineKeys(ctx, current().providers)

  ctx.tools.register(understandImageTool(
    ctx,
    () => resolved().defaultPrompt,
    () => ({ maxBytes: resolved().maxBytes, allowPrivateNetwork: resolved().allowPrivateNetwork }),
  ))

  const registerRoutes = (): void => {
    if (ctx.get('webServer') === undefined) return
    registerAttachRoute(ctx, {
      readMaxBytes: () => current().maxBytes ?? DEFAULT_MAX_BYTES,
      readConfigView: () => readConfigView(ctx),
      writeConfigView: (body) => writeConfigView(ctx, body),
      runConnectionTest: (body) => runConnectionTest(ctx, body as Parameters<typeof runConnectionTest>[1]),
      listEndpointModels: (body) => listEndpointModels(ctx, body as Parameters<typeof listEndpointModels>[1]),
      catalog: () => VISION_PROVIDER_CATALOG,
    })
  }
  registerRoutes()
  if (ctx.get('webServer') === undefined) {
    let attempts = 0
    const pollForServer = (): void => {
      if (ctx.get('webServer') !== undefined) { registerRoutes(); return }
      if (attempts < 100) {
        attempts += 1
        setTimeout(pollForServer, 200)
      }
    }
    pollForServer()
  }
}

/**
 * Build the endpoint snapshot one call holds: the named provider's resolved
 * facts, plus the request's model override. The adapter deep-freezes the
 * snapshot before the wire layer sees it, so an in-flight request never
 * observes a settings change and the next call re-resolves.
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
    ...spec.apiKey === undefined || spec.apiKey.length === 0 ? {} : { inlineApiKey: spec.apiKey },
  }
}
