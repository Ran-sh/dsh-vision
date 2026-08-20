/**
 * The `understand_image` tool: a thin consumer of `ctx.vision`. It loads one
 * or more images, classifies broad visual intent, optionally reuses bounded
 * task-scoped visual evidence, and hands a budgeted request to the runtime.
 * Provider/model/wire details remain outside the tool.
 * @module dsh-plugin-image-mind/tools/understand-image
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'
import { inferVisionTask, routeVisionTask } from '@ran-sh/dsh-vision'
import type { VisionCacheMode, VisionCacheStore, VisionTrace } from '@ran-sh/dsh-vision'
import type {} from '@ran-sh/dsh-vision'
import { loadImage } from '../media/load.ts'
import type { LoadedImage } from '../media/types.ts'
import { isReusableEvidenceTask, reusableEvidenceKey, reusableEvidencePrompt } from '../runtime/reusable-evidence.ts'

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

function cacheOnlyTrace(): VisionTrace {
  return {
    providerCalls: 0,
    payloadBytes: 0,
    cacheHits: 1,
    retries: 0,
    modelFallbacks: 0,
    providerFallbacks: 0,
    splits: 0,
  }
}

export function understandImageTool(
  ctx: Context,
  defaultPrompt: () => string,
  mediaOptions: () => { maxBytes: number; allowPrivateNetwork: boolean },
  evidenceCache?: VisionCacheStore,
): ReturnType<typeof defineTool> {
  const DESCRIPTION_HEAD =
    'Inspect one or more images — local absolute paths, http(s) URLs, or the JSON of image attachment '
    + 'notes — and return visual evidence the main model can reason over. YOU MUST pass either `image` '
    + '(single) or `images` (array) — never call with neither. Call this for OCR, charts, screenshots, '
    + 'UI analysis, translation, code/terminal images, documents, comparisons, or photos. '
    + 'Always pass an explicit `prompt` describing what the user needs. For stable evidence tasks such as '
    + 'OCR/UI/code/documents/charts, image-mind may reuse task-scoped visual evidence across later questions. '
    + 'If the user explicitly asks you to look again, re-read/OCR from the pixels, ignore a previous '
    + 'analysis, or verify a detail afresh, set `cache` to `refresh`. Use `no-store` only when the '
    + 'caller specifically needs the result not to enter either cache layer.'

  return defineTool({
    name: 'understand_image',
    description: DESCRIPTION_HEAD
      + ' Each image may be a local path, an http(s) URL, the JSON object from an `[image attachment …]` '
      + 'note, or the bare attachment id from `![图片](/image-mind/raw/<id>)`. Prefer the complete hidden '
      + '`[image attachment …]` JSON when available because it survives a host restart.',
    parameters: {
      image: {
        type: 'string',
        description: 'REQUIRED unless `images` is passed. Absolute local image path, http(s) URL, complete [image attachment …] JSON object, or bare attachment id.',
      },
      images: {
        type: 'array',
        items: { type: 'string' },
        description: `REQUIRED unless \`image\` is passed. Several image references to analyze together. At most ${MAX_IMAGES_PER_REQUEST}. Mutually exclusive with \`image\`.`,
      },
      prompt: {
        type: 'string',
        description: 'Precise instruction for the visual task, e.g. exact OCR, table extraction, UI diagnosis, comparison, or translation.',
      },
      provider: {
        type: 'string',
        description: 'Optional configured vision-provider id. Explicit selection disables automatic provider substitution and layered evidence reuse.',
      },
      model: {
        type: 'string',
        description: 'Optional model id override. Explicit selection disables automatic model/provider substitution and layered evidence reuse.',
      },
      cache: {
        type: 'string',
        enum: ['use', 'refresh', 'no-store'],
        description: 'Cache policy. `use` (default), `refresh` for fresh pixels, or `no-store` to bypass both semantic and layered evidence caches.',
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
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const { maxBytes, allowPrivateNetwork } = mediaOptions()
      const hasSingle = args.image !== undefined && args.image.trim().length > 0
      const hasMany = (args.images ?? []).some(ref => ref.trim().length > 0)
      if (hasSingle && hasMany) throw new Error('image-mind: pass either `image` (single) or `images` (array), not both')

      const rawRefs = hasSingle ? [args.image!.trim()] : (args.images ?? []).map(ref => ref.trim())
      if (rawRefs.some(ref => ref.length === 0)) throw new Error('image-mind: image references must be non-empty strings')
      const refs = rawRefs.filter(ref => ref.length > 0)
      if (refs.length === 0) throw new Error('image-mind: pass `image` (single) or `images` (array) with at least one image reference')
      if (refs.length > MAX_IMAGES_PER_REQUEST) throw new Error(`image-mind: at most ${MAX_IMAGES_PER_REQUEST} images per call; got ${refs.length}`)

      const images = await loadImagesConcurrent(ctx, refs, exec.signal, maxBytes, allowPrivateNetwork, MAX_TOTAL_IMAGE_BYTES_FACTOR)
      const callerPrompt = args.prompt ?? defaultPrompt()
      const task = inferVisionTask(callerPrompt, images.length)
      const budget = routeVisionTask(task).policy
      const cacheMode = args.cache ?? 'use'
      const explicitRoute = (args.provider?.trim().length ?? 0) > 0 || (args.model?.trim().length ?? 0) > 0
      const useEvidenceLayer = evidenceCache !== undefined
        && !explicitRoute
        && cacheMode !== 'no-store'
        && isReusableEvidenceTask(task)
      const understandingKey = useEvidenceLayer ? reusableEvidenceKey(images, task) : undefined

      if (understandingKey !== undefined && cacheMode === 'use') {
        const hit = evidenceCache!.getUnderstanding(understandingKey)
        if (hit !== undefined) {
          return {
            text: hit.facts,
            model: hit.model,
            provider: hit.provider,
            images: images.map((image, index) => ({
              source: safeImageIdentity(refs[index]),
              mimeType: image.mimeType,
              bytes: image.bytes.length,
            })),
            trace: cacheOnlyTrace(),
          }
        }
      }

      const requestPrompt = useEvidenceLayer ? reusableEvidencePrompt(task, images.length) : callerPrompt
      const result = await ctx.vision.call({
        provider: args.provider,
        model: args.model,
        prompt: requestPrompt,
        images,
        maxOutputTokens: budget.maxOutputTokens,
        ...args.cache === undefined ? {} : { cache: args.cache },
        signal: exec.signal,
      })

      if (understandingKey !== undefined) {
        evidenceCache!.setUnderstanding({
          imageKey: understandingKey,
          facts: result.text,
          provider: result.provider,
          model: result.model,
          createdAt: Date.now(),
        })
      }

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
