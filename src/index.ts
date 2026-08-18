/**
 * Model-facing image understanding for text-only models. Each call loads one
 * image — a local file path, an http(s) URL, an attachment reference JSON, or
 * the bare attachment id from a pasted markdown reference — and asks a
 * vision-language model at an OpenAI-compatible endpoint to answer over it;
 * only the returned text crosses into the conversation, so the image never
 * enters the session log.
 *
 * This entry is composition only: it creates the VisionRuntime, registers the
 * provider directory, registers the OpenAI-compatible adapter, installs the
 * settings section, registers the thin `understand_image` tool, and mounts
 * the attachment routes. Provider selection, HTTP, credential parsing, and
 * configuration validation live in their own layers.
 *
 * Personal plugin, written from scratch: plugin id `image-mind`, tool name
 * `understand_image`, route prefix /image-mind. The plugin may be mounted
 * without configuration; endpoint and model are validated per call, and the
 * "image-mind" settings section — rendered by the web GUI's built-in
 * plugin-config page — edits the fields live.
 * @module dsh-plugin-image-mind
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { VisionRuntime } from './runtime/index.ts'
import { OpenAICompatibleVisionAdapter } from './adapters/openai-compatible/index.ts'
import { resolveApiKey } from './credentials/resolve.ts'
import { Config, IMAGE_MIND_SETTINGS_NAMESPACE, resolveConfig, type Config as ConfigType, type ResolvedConfig } from './config.ts'
import { understandImageTool } from './tools/understand-image.ts'
import { registerAttachRoute } from './attachments/routes.ts'
import { readConfigView, writeConfigView } from './attachments/legacy-config.ts'
import { runConnectionTest, listEndpointModels } from './runtime/vision-rpc.ts'
import { VISION_PROVIDER_CATALOG } from './providers/catalog.ts'
import { createVisionCache } from './cache/vision-cache.ts'
import { DEFAULT_MAX_BYTES } from './media/types.ts'

export const name = 'image-mind'
export const inject = ['tools', 'webServer']

/**
 * Register the vision capability: runtime, adapter, settings, tool, routes.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: ConfigType = {}): void {
  // The loader fills schema defaults before apply, so an unconfigured entry
  // still arrives with default fields set. Only a config that actually names
  // a provider or active is validated eagerly — an unconfigured mount loads
  // silently and the first call fails with a clear "no active provider".
  const configHasProviders = config.providers !== undefined && Object.keys(config.providers).length > 0
  if (configHasProviders || config.active !== undefined) {
    resolveConfig(config)
  }
  let current: () => ConfigType = () => config
  // Memoized resolution by raw snapshot identity, like the official llm
  // plugins: a settings change that resolves to identical facts reuses the
  // last snapshot instead of rebuilding it.
  let lastRaw: ConfigType | undefined
  let memoized: ResolvedConfig | undefined
  const resolved = (): ResolvedConfig => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveConfig(raw)
    lastRaw = raw
    memoized = next
    return next
  }
  resolved()

  // The vision runtime: an independent service, NOT ctx.llm — a vision model
  // is a perception backend for text-only models, never a main-session model.
  const vision = new VisionRuntime(ctx)
  // Short-lived semantic cache scoped to this mount: identical provider +
  // model + image + prompt within the TTL reuse the prior answer.
  const cache = createVisionCache()
  const adapter = new OpenAICompatibleVisionAdapter({
    resolveApiKey: connection => resolveApiKey(ctx, connection),
    cache,
  })

  // The OpenAI-compatible adapter serves every configured provider route.
  // Routes follow the settings section: a section change re-registers the
  // same adapter instance in place (atomic replace), so no request observes a
  // gap and the next call uses the new route set.
  let registration: ReturnType<typeof vision.registerAdapter> | undefined
  let registeredRoutes: string[] | undefined
  const ensureRegistration = (): void => {
    const routes = Object.keys(resolved().providers)
    if (routes.length === 0) {
      registeredRoutes = routes
      return
    }
    if (registration !== undefined && registeredRoutes !== undefined
      && routes.length === registeredRoutes.length && routes.every((route, index) => route === registeredRoutes![index])) {
      return
    }
    if (registration === undefined) {
      registration = vision.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredRoutes = routes
  }
  ensureRegistration()

  // The provider directory: every catalog entry plus every configured route,
  // so configuration surfaces can offer the full set.
  const directory = VISION_PROVIDER_CATALOG.map(entry => ({
    id: entry.id,
    displayName: entry.name,
    adapter: 'openai-compatible',
    baseURL: entry.baseURL,
    apiStyle: entry.apiStyle ?? 'chat-completions',
    ...entry.apiKeyEnv === '' ? {} : { apiKeyEnv: entry.apiKeyEnv },
  }))
  for (const descriptor of directory) {
    vision.registerProvider(descriptor)
  }
  for (const id of Object.keys(resolved().providers)) {
    if (vision.getProvider(id) === undefined) {
      vision.registerProvider({ id, displayName: id, adapter: 'openai-compatible', apiStyle: 'chat-completions' })
    }
  }

  installSettingsSection(ctx, IMAGE_MIND_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // A section change re-resolves and atomically re-registers the route set.
      try {
        resolved()
        ensureRegistration()
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

  // The thin tool: it only loads the image and hands the request to ctx.vision.
  ctx.tools.register(understandImageTool(ctx, resolved, () => resolved().defaultPrompt))

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
