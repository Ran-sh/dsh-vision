/**
 * Model-facing image understanding for text-only models. Each call loads one
 * image — a local file path, an http(s) URL, an attachment reference JSON, or
 * the bare attachment id from a pasted markdown reference — and asks a
 * vision-language model at an OpenAI-compatible endpoint to answer over it;
 * only the returned text crosses into the conversation, so the image never
 * enters the session log.
 *
 * Personal plugin, written from scratch: plugin id `image-mind`, tool name
 * `understand_image`, route prefix /image-mind. The plugin may be mounted
 * without configuration; endpoint and
 * model are validated per call (or eagerly at load when a composition entry
 * actually configures them), and the "image-mind" settings section — rendered
 * by the web GUI's built-in plugin-config page — edits the fields live.
 * @module dsh-plugin-image-mind
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { registerAttachRoute } from './attach.ts'
import { DEFAULT_MAX_BYTES } from './media.ts'
import { Config, IMAGE_MIND_SETTINGS_NAMESPACE, isProviderComplete, resolveApiKey, resolveConfig, type ResolvedConfig, type ResolvedProvider } from './config.ts'
import { callVision, createVisionCache, loadImage } from './vision.ts'

export const name = 'image-mind'
export const inject = ['tools', 'webServer']

const DESCRIPTION_HEAD =
  'Inspect one image — a local absolute path, an http(s) URL, or the JSON of an image attachment '
  + 'note — and return the text the user needs. Use when the user references an image file or URL, '
  + 'or when a task needs OCR, chart or diagram reading, screenshot or UI analysis, translation of '
  + 'image text, or photo understanding. '
  + 'Always pass an explicit `prompt` with a precise instruction — e.g. "transcribe all text", '
  + '"extract the table as CSV", "diagnose the UI layout problems", "translate the text into '
  + 'Chinese" — instead of leaving it to the default description: a targeted instruction produces '
  + 'a much more useful answer. '
  + 'When the task involves several images (compare screenshots, diff two versions, batch-read a '
  + 'page of photos), CALL THIS TOOL ONCE PER IMAGE — give each call its own `image` reference '
  + 'and the same or tailored `prompt` — then combine the answers in your reply. '

/** The understand_image call's validated arguments. */
export interface UnderstandImageArgs {
  image: string
  prompt?: string
  provider?: string
}

/**
 * Pure call view: a generic read card, with a file location for local paths.
 * @param args - the validated call arguments.
 * @returns the pending-state card for one understand_image call.
 */
export function understandImageCallView(args: UnderstandImageArgs): GenericCallView {
  return {
    card: 'generic',
    title: 'Understand image',
    kind: 'read',
    rawInput: args,
    .../^https?:\/\//i.test(args.image) ? {} : { locations: [{ path: args.image }] },
  }
}

/**
 * Register the `understand_image` tool on `ctx.tools`. The image never enters
 * the conversation: the tool returns only the vision model's text answer. The
 * `image-mind` settings section layers over the composition entry and is
 * re-resolved per call, so the Settings card's changes reach the very next
 * invocation. Repeat calls for the same image and prompt reuse a short-lived
 * semantic cache so the endpoint is not called twice in quick succession.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // The loader fills schema defaults before apply, so an unconfigured entry
  // still arrives with default fields set. Only a config that actually names
  // a provider or active is validated eagerly — an unconfigured mount loads
  // silently and the first call fails with a clear "no active provider".
  const configHasProviders = config.providers !== undefined && Object.keys(config.providers).length > 0
  if (configHasProviders || config.active !== undefined) {
    resolveConfig(config)
  }
  let current: () => Config = () => config
  installSettingsSection(ctx, IMAGE_MIND_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
    validate: (value) => {
      const hasProviders = value.providers !== undefined && Object.keys(value.providers).length > 0
      if (hasProviders || value.active !== undefined) resolveConfig(value)
    },
  })
  const spec = (): ResolvedConfig => resolveConfig(current())
  // Short-lived semantic cache scoped to this mount: identical image + prompt
  // within the TTL reuse the prior answer instead of a second fetch.
  const visionCache = createVisionCache()
  // The webserver inject is required by the entry, but the route still probes
  // per registration so headless mounts keep loading.
  registerAttachRoute(ctx, () => current().maxBytes ?? DEFAULT_MAX_BYTES)
  // Pick the provider one call uses: an explicit `provider` argument wins,
  // else the configured `active`, else the single provider when only one is
  // defined. Undefined here yields a clear "no provider" failure.
  const providerFor = (resolved: ResolvedConfig, requested: string | undefined): ResolvedProvider | undefined => {
    const ids = Object.keys(resolved.providers)
    if (requested !== undefined) {
      const hit = resolved.providers[requested.trim()]
      if (hit === undefined) {
        throw new Error(`image-mind: provider ${JSON.stringify(requested.trim())} is not defined`)
      }
      if (!isProviderComplete(hit)) {
        throw new Error(`image-mind: provider ${JSON.stringify(requested.trim())} is incomplete; fill its baseURL and model first`)
      }
      return hit
    }
    if (resolved.active !== undefined) return resolved.providers[resolved.active]
    if (ids.length === 1) {
      const only = resolved.providers[ids[0]]
      return isProviderComplete(only) ? only : undefined
    }
    return undefined
  }
  ctx.tools.register(defineTool({
    name: 'understand_image',
    description: DESCRIPTION_HEAD
      + 'The image may be a local path, an http(s) URL, the JSON object from an `[image attachment …]` '
      + "note, or — the common case when the user sent an image through this plugin's input rewriting — a "
      + 'short markdown image reference like `![图片](/image-mind/raw/sha256:abc…)` pasted into '
      + 'the conversation. In the markdown form, take the attachment id from the URL and pass that id '
      + 'as the `image` value (never the whole markdown, and never a made-up path); the tool resolves '
      + 'the id to the stored image. The image itself never enters the conversation — only the '
      + 'returned text is shown to you.',
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: 'Absolute path to a local image file, an http(s) URL of the image, the JSON object from an [image attachment …] note, or the bare attachment id (e.g. sha256:abc…) taken from the markdown image reference ![图片](/image-mind/raw/<id>) that appeared in the conversation.',
      },
      prompt: {
        type: 'string',
        description: 'Your precise instruction for the vision model about this image (e.g. "transcribe all text", "extract the table as CSV", "diagnose the UI problems", "translate the text"). Prefer a targeted prompt over the generic default description.',
      },
      provider: {
        type: 'string',
        description: 'Optional configured vision-provider id to use for this call; defaults to the active provider.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          model: { type: 'string', required: true },
          provider: { type: 'string' },
          image: { type: 'string', required: true },
          mimeType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const resolved = spec()
      const provider = providerFor(resolved, args.provider)
      if (provider === undefined) {
        throw new Error('image-mind: no active vision provider configured; set one in 设置 → 插件 → 插件配置 → 图像理解')
      }
      const apiKey = await resolveApiKey(ctx, provider)
      const image = await loadImage(ctx, args.image, exec.signal, resolved.maxBytes)
      const text = await callVision(provider, apiKey, args.prompt ?? resolved.defaultPrompt, image, exec.signal, resolved.timeoutMs, visionCache)
      return { text, model: provider.model, provider: args.provider ?? resolved.active, image: args.image, mimeType: image.mimeType, bytes: image.bytes.length }
    },
    presentCall: understandImageCallView,
  }))
}
