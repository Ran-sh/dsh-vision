/**
 * Model-facing image understanding for text-only models. Each call loads one
 * image —a local file path, an http(s) URL, an attachment reference JSON, or
 * the bare attachment id from a pasted markdown reference —and asks a
 * vision-language model at an OpenAI-compatible endpoint to answer over it;
 * only the returned text crosses into the conversation, so the image never
 * enters the session log.
 * @module dsh-plugin-image-mind
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type {} from '@ran-sh/dsh-vision'
import { VisionError, createMemoryVisionCache } from '@ran-sh/dsh-vision'
import type { VisionCacheStore, VisionRequest } from '@ran-sh/dsh-vision'
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
import { registerImageMindSystemPrompt } from './runtime/system-prompt-routing.ts'
import { VISION_PROVIDER_CATALOG } from './providers/catalog.ts'
import { createVisionCache } from './cache/vision-cache.ts'
import { DEFAULT_MAX_BYTES } from './media/types.ts'

export const name = 'image-mind'
export const inject = ['vision', 'tools', 'systemPrompt']

export { runConnectionTest, listEndpointModels } from './runtime/vision-rpc.ts'
export { VISUAL_FIXTURES, answerMatches } from './runtime/visual-fixtures.ts'

const EVIDENCE_CACHE_MAX_ENTRIES = 64
const EVIDENCE_CACHE_TTL_MS = 5 * 60_000

/** Register the vision capability: adapter, directory, settings, tool, routes. */
export function apply(ctx: Context, config: ConfigType = {}): void {
  const configHasProviders = config.providers !== undefined && Object.keys(config.providers).length > 0
  if (configHasProviders || config.active !== undefined) resolveConfig(config)

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
  let evidenceCache = createMemoryVisionCache({ maxEntries: EVIDENCE_CACHE_MAX_ENTRIES, ttlMs: EVIDENCE_CACHE_TTL_MS })
  // Stable proxy lets settings changes replace the backing store without
  // re-registering the tool closure.
  const evidenceCacheView: VisionCacheStore = {
    getUnderstanding: key => evidenceCache.getUnderstanding(key),
    setUnderstanding: entry => evidenceCache.setUnderstanding(entry),
    getAnswer: key => evidenceCache.getAnswer(key),
    setAnswer: entry => evidenceCache.setAnswer(entry),
  }
  const resetEvidenceCache = (): void => {
    evidenceCache = createMemoryVisionCache({ maxEntries: EVIDENCE_CACHE_MAX_ENTRIES, ttlMs: EVIDENCE_CACHE_TTL_MS })
  }

  const reliability = createProviderReliabilityTracker()
  const wireAdapter = new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: (provider, request) => connectionSnapshotOf(resolved(), provider, request),
    resolveApiKey: options => resolveApiKey(ctx, options),
    resolveProviderFallbacks: (provider, request) => reliability.fallbacks(resolved(), provider, request),
    cache,
  })
  const adapter = new ReliabilityVisionAdapter(wireAdapter, reliability)

  let registration: ReturnType<typeof ctx.vision.registerAdapter> | undefined
  let registeredRoutes: string[] | undefined
  const ensureRegistration = (): void => {
    const routes = Object.keys(resolved().providers)
    if (registration !== undefined && registeredRoutes !== undefined
      && routes.length === registeredRoutes.length && routes.every((route, index) => route === registeredRoutes![index])) return
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

  const catalogIds = new Set(VISION_PROVIDER_CATALOG.map(entry => entry.id))
  ctx.vision.registerConfigurableProviders(
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
      && ids.length === registeredUserEntries.length && ids.every((id, index) => id === registeredUserEntries![index])) return
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
    setSource: (source) => { current = source },
    onChange: () => {
      try {
        resolved()
        ensureRegistration()
        ensureDirectory()
        // Provider/model/policy changes invalidate reusable evidence. Exact
        // semantic request cache remains adapter-owned and key-scoped.
        resetEvidenceCache()
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

  registerImageMindSystemPrompt(ctx)
  ctx.tools.register(understandImageTool(
    ctx,
    () => resolved().defaultPrompt,
    () => ({ maxBytes: resolved().maxBytes, allowPrivateNetwork: resolved().allowPrivateNetwork }),
    evidenceCacheView,
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
 * Build an immutable endpoint snapshot. Task-aware `maxOutputTokens` is a
 * caller preference, while the configured provider value remains the hard
 * safety/cost cap. Therefore a task may lower the cap but never raise it.
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
  if (spec === undefined) throw new VisionError(`image-mind: provider ${JSON.stringify(id)} is not defined`, 'PROVIDER_NOT_FOUND')

  const requestedModel = request?.model
  const modelOverride = requestedModel !== undefined && requestedModel.trim().length > 0 ? requestedModel.trim() : undefined
  const requestedMax = request?.maxOutputTokens
  const maxOutputTokens = requestedMax === undefined ? spec.maxOutputTokens : Math.min(spec.maxOutputTokens, requestedMax)

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
