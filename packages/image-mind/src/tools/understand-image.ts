/**
 * The `understand_image` tool: a thin consumer of `ctx.vision`. It loads one
 * or more images (media layer) and hands the request to the runtime — it
 * never touches baseURL, apiKey, apiStyle, timeout, fetch, protocol selection,
 * model discovery, or retry policy. Provider and model defaults are resolved
 * by the runtime from its own provider registration. The image never enters
 * the conversation: only the returned text crosses.
 * @module dsh-plugin-image-mind/tools/understand-image
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'
import { loadImage } from '../media/load.ts'
import type { LoadedImage } from '../media/types.ts'
import type { VisionCacheMode } from '@ran-sh/dsh-vision'
import type {} from '@ran-sh/dsh-vision'

export const MAX_IMAGES_PER_REQUEST = 8
export const MAX_TOTAL_IMAGE_BYTES_FACTOR = 2

async function loadImagesConcurrent(
  ctx: Context,
  refs: string[],
  signal: AbortSignal,
  maxBytes: number,
  allowPrivateNetwork: boolean,
  factor: number,
): Promise<LoadedImage[]> {
  const totalCap = maxBytes * factor
  const images: LoadedImage[] = new Array(refs.length)
  let total = 0
  let cursor = 0
  const internal = new AbortController()
  const onCallerAbort = (): void => { internal.abort() }
  if (signal.aborted) internal.abort()
  else signal.addEventListener('abort', onCallerAbort, { once: true })
  const failures: unknown[] = []
  const workers = Array.from({ length: 2 }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= refs.length) return
      try {
        const image = await loadImage(ctx, refs[index], internal.signal, maxBytes, { allowPrivateNetwork })
        total += image.bytes.length
        if (total > totalCap) throw new Error(`image-mind: combined image size exceeds the ${totalCap}-byte bound`)
        images[index] = image
      } catch (error) {
        failures.push(error)
        internal.abort()
        throw error
      }
    }
  })
  try {
    await Promise.all(workers)
  } finally {
    signal.removeEventListener('abort', onCallerAbort)
  }
  if (failures.length > 0) throw failures[0]
  return images
}

export function safeImageIdentity(ref: string): string {
  if (/^https?:\/\//i.test(ref)) {
    try {
      const url = new URL(ref)
      return `${url.hostname}/...`
    } catch {
      return 'url/...'
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return 'url/...'
  const base = ref.split(/[/\\]/).pop()
  return base !== undefined && base.length > 0 ? base : ref.slice(0, 40)
}

export interface UnderstandImageArgs {
  image?: string
  images?: string[]
  prompt?: string
  provider?: string
  model?: string
  cache?: VisionCacheMode
}

export function understandImageCallView(args: UnderstandImageArgs): GenericCallView {
  const refs = args.image !== undefined ? [args.image] : args.images ?? []
  return {
    card: 'generic',
    title: 'Understand image',
    kind: 'read',
    rawInput: args,
    ...refs.filter(ref => !/^https?:\/\//i.test(ref)).length > 0
      ? { locations: refs.filter(ref => !/^https?:\/\//i.test(ref)).map(ref => ({ path: ref })) }
      : {},
  }
}

export function understandImageTool(
  ctx: Context,
  defaultPrompt: () => string,
  mediaOptions: () => { maxBytes: number; allowPrivateNetwork: boolean },
): ReturnType<typeof defineTool> {
  const DESCRIPTION_HEAD =
    'Inspect one or more images — local absolute paths, http(s) URLs, or the JSON of image attachment '
    + 'notes — and return the text the user needs. YOU MUST pass either `image` (single) or `images` '
    + '(array) — never call with neither. Call this when the user references an image file or URL, '
    + 'or when a task needs OCR, chart or diagram reading, screenshot or UI analysis, translation of '
    + 'image text, or photo understanding. '
    + 'Always pass an explicit `prompt` with a precise instruction — e.g. "transcribe all text", '
    + '"extract the table as CSV", "diagnose the UI layout problems", "translate the text into '
    + 'Chinese" — instead of leaving it to the default description: a targeted instruction produces '
    + 'a much more useful answer. '
    + 'When the task involves several images (compare screenshots, diff two versions, batch-read a '
    + `page of photos), pass them as the \`images\` array in ONE call (up to ${MAX_IMAGES_PER_REQUEST}): the vision model sees them together. `
    + 'If the user explicitly asks you to look again, re-read/OCR from the pixels, ignore a previous '
    + 'analysis, or verify a detail afresh, set `cache` to `refresh`. Use `no-store` only when the '
    + 'caller specifically needs the result not to enter the short-lived semantic cache. '
    + 'Do NOT re-call this tool for an image whose analysis already appears in the conversation unless '
    + 'the user asks for a fresh look or a materially different visual question.'

  return defineTool({
    name: 'understand_image',
    description: DESCRIPTION_HEAD
      + 'Each image may be a local path, an http(s) URL, the JSON object from an `[image attachment …]` '
      + "note, or — the common case when the user sent an image through this plugin's input rewriting — a "
      + 'short markdown image reference like `![图片](/image-mind/raw/sha256:abc…)` pasted into '
      + 'the conversation. Prefer the complete hidden `[image attachment …]` JSON when available '
      + '(it survives a host restart); otherwise take the attachment id from the markdown URL and pass '
      + 'that id as the `image`/`images` value. Never pass the whole markdown or invent a path.',
    parameters: {
      image: {
        type: 'string',
        description: 'REQUIRED unless `images` is passed. Absolute local image path, http(s) URL, complete [image attachment …] JSON object, or bare attachment id from ![图片](/image-mind/raw/<id>).',
      },
      images: {
        type: 'array',
        items: { type: 'string' },
        description: `REQUIRED unless \`image\` is passed. Several image references to analyze together. At most ${MAX_IMAGES_PER_REQUEST}. Mutually exclusive with \`image\`.`,
      },
      prompt: {
        type: 'string',
        description: 'Precise instruction for the vision model, e.g. exact OCR, table extraction, UI diagnosis, comparison, or translation.',
      },
      provider: {
        type: 'string',
        description: 'Optional configured vision-provider id; explicit selection disables automatic cross-provider fallback.',
      },
      model: {
        type: 'string',
        description: 'Optional model id override; explicit selection disables automatic model/provider substitution.',
      },
      cache: {
        type: 'string',
        enum: ['use', 'refresh', 'no-store'],
        description: 'Semantic-cache policy. `use` (default), `refresh` for a fresh pixel analysis, or `no-store` to bypass reads/writes.',
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
          images: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true },
                mimeType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
                bytes: { type: 'integer', required: true },
              },
            },
          },
          trace: {
            type: 'object',
            additionalProperties: false,
            properties: {
              providerCalls: { type: 'integer', required: true },
              payloadBytes: { type: 'integer', required: true },
              cacheHits: { type: 'integer', required: true },
              retries: { type: 'integer', required: true },
              modelFallbacks: { type: 'integer', required: true },
              providerFallbacks: { type: 'integer', required: true },
              splits: { type: 'integer', required: true },
            },
          },
        },
      },
      // Conversation/UI rendering stays clean: structured trace metadata is
      // available to diagnostics/benchmarks but the user sees the answer text.
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const { maxBytes, allowPrivateNetwork } = mediaOptions()
      const hasSingle = args.image !== undefined && args.image.trim().length > 0
      const hasMany = (args.images ?? []).some(ref => ref.trim().length > 0)
      if (hasSingle && hasMany) {
        throw new Error('image-mind: pass either `image` (single) or `images` (array), not both')
      }
      const rawRefs = hasSingle ? [args.image!.trim()] : (args.images ?? []).map(ref => ref.trim())
      if (rawRefs.some(ref => ref.length === 0)) {
        throw new Error('image-mind: image references must be non-empty strings')
      }
      const refs = rawRefs.filter(ref => ref.length > 0)
      if (refs.length === 0) {
        throw new Error('image-mind: pass `image` (single) or `images` (array) with at least one image reference')
      }
      if (refs.length > MAX_IMAGES_PER_REQUEST) {
        throw new Error(`image-mind: at most ${MAX_IMAGES_PER_REQUEST} images per call; got ${refs.length}`)
      }
      const images = await loadImagesConcurrent(ctx, refs, exec.signal, maxBytes, allowPrivateNetwork, MAX_TOTAL_IMAGE_BYTES_FACTOR)
      const result = await ctx.vision.call({
        provider: args.provider,
        model: args.model,
        prompt: args.prompt ?? defaultPrompt(),
        images,
        ...args.cache === undefined ? {} : { cache: args.cache },
        signal: exec.signal,
      })
      return {
        text: result.text,
        model: result.model,
        provider: result.provider,
        images: images.map((image, index) => ({
          source: safeImageIdentity(refs[index]),
          mimeType: image.mimeType,
          bytes: image.bytes.length,
        })),
        ...result.trace === undefined ? {} : { trace: result.trace },
      }
    },
    presentCall: understandImageCallView,
  })
}
