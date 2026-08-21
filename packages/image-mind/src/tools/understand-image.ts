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
import type { VisionCacheMode, VisionCacheStore, VisionTask, VisionTrace } from '@ran-sh/dsh-vision'
import { loadImage } from '../media/load.ts'
import type { LoadedImage } from '../media/types.ts'
import { MAX_SESSION_BATCH_OFFSET, sessionAttachmentRefsByOffset } from '../attachments/session-history.ts'
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
  const normalized = ref.trim()
  if (normalized.startsWith('{') || /^sha256:/i.test(normalized)) return 'attachment'
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized)
      return `${url.hostname}/...`
    } catch {
      return 'url/...'
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) return 'url/...'
  const base = normalized.split(/[/\\]/).pop()
  return base !== undefined && base.length > 0 ? base : 'image'
}

export interface UnderstandImageArgs {
  image?: string
  images?: string[]
  /** 0 = latest session image batch, 1 = previous distinct batch, etc. */
  sessionBatchOffset?: number
  prompt?: string
  provider?: string
  model?: string
  cache?: VisionCacheMode
}

export type UnderstandImageRouteSource = 'provider' | 'semantic-cache' | 'evidence-cache'

export interface UnderstandImageDecision {
  task: VisionTask
  cacheMode: VisionCacheMode
  evidenceLayerEnabled: boolean
}

export interface UnderstandImageRoute extends UnderstandImageDecision {
  source: UnderstandImageRouteSource
  requestedProvider?: string
  requestedModel?: string
  selectedProvider: string
  selectedModel: string
  modelFallback: boolean
  providerFallback: boolean
}

function explicitValue(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined
}

export function understandImageRoute(
  args: Pick<UnderstandImageArgs, 'provider' | 'model'>,
  selectedProvider: string,
  selectedModel: string,
  decision: UnderstandImageDecision,
  trace?: VisionTrace,
  sourceOverride?: UnderstandImageRouteSource,
): UnderstandImageRoute {
  const requestedProvider = explicitValue(args.provider)
  const requestedModel = explicitValue(args.model)
  const source = sourceOverride
    ?? (trace !== undefined && trace.providerCalls === 0 && trace.cacheHits > 0 ? 'semantic-cache' : 'provider')
  return {
    source,
    ...decision,
    ...requestedProvider === undefined ? {} : { requestedProvider },
    ...requestedModel === undefined ? {} : { requestedModel },
    selectedProvider,
    selectedModel,
    modelFallback: (trace?.modelFallbacks ?? 0) > 0,
    providerFallback: (trace?.providerFallbacks ?? 0) > 0,
  }
}

export function understandImageCallView(args: UnderstandImageArgs): GenericCallView {
  const refs = args.image !== undefined ? [args.image] : args.images ?? []
  const rawInput = {
    ...args,
    ...args.image === undefined ? {} : { image: safeImageIdentity(args.image) },
    ...args.images === undefined ? {} : { images: args.images.map(safeImageIdentity) },
  }
  const localRefs = refs.filter((ref) => {
    const normalized = ref.trim()
    return !/^https?:\/\//i.test(normalized)
      && !/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)
      && !normalized.startsWith('{')
      && !/^sha256:/i.test(normalized)
  })
  return {
    card: 'generic',
    title: 'Understand image',
    kind: 'read',
    rawInput,
    ...localRefs.length > 0 ? { locations: localRefs.map(path => ({ path })) } : {},
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
    'Inspect one or more images and return visual evidence the main model can reason over. When the current '
    + 'DSH session has uploaded images, omit `image`/`images` and use `sessionBatchOffset` to select a recent '
    + 'session batch (`0` latest, `1` previous, and so on). Explicit references are also supported: local absolute '
    + 'paths, http(s) URLs, complete image attachment JSON, or bare attachment ids. Call this for OCR, charts, '
    + 'screenshots, UI analysis, translation, code/terminal images, documents, comparisons, or photos. Always pass '
    + 'an explicit `prompt` describing what the user needs. For stable evidence tasks such as OCR/UI/code/documents/'
    + 'charts, image-mind may reuse task-scoped visual evidence across later questions. If the user explicitly asks '
    + 'you to look again, re-read/OCR from the pixels, ignore a previous analysis, or verify a detail afresh, set '
    + '`cache` to `refresh`. Use `no-store` only when the caller specifically needs the result not to enter either '
    + 'cache layer.'

  return defineTool({
    name: 'understand_image',
    description: DESCRIPTION_HEAD,
    parameters: {
      image: {
        type: 'string',
        description: 'Optional explicit single image reference. Omit when selecting an uploaded session image batch.',
      },
      images: {
        type: 'array',
        items: { type: 'string' },
        description: `Optional explicit image references. At most ${MAX_IMAGES_PER_REQUEST}. Mutually exclusive with \`image\`; omit both when selecting a session image batch.`,
      },
      sessionBatchOffset: {
        type: 'integer',
        description: `Optional session-relative batch selector used only when image/images are omitted: 0 = latest, 1 = previous, up to ${MAX_SESSION_BATCH_OFFSET}.`,
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
          route: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              source: { type: 'string', required: true, enum: ['provider', 'semantic-cache', 'evidence-cache'] },
              task: { type: 'string', required: true, enum: ['ocr', 'ui-review', 'code', 'document', 'chart', 'compare', 'photo', 'screenshot', 'translate', 'general'] },
              cacheMode: { type: 'string', required: true, enum: ['use', 'refresh', 'no-store'] },
              evidenceLayerEnabled: { type: 'boolean', required: true },
              requestedProvider: { type: 'string' },
              requestedModel: { type: 'string' },
              selectedProvider: { type: 'string', required: true },
              selectedModel: { type: 'string', required: true },
              modelFallback: { type: 'boolean', required: true },
              providerFallback: { type: 'boolean', required: true },
            },
          },
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
          usage: {
            type: 'object',
            additionalProperties: false,
            properties: {
              inputTokens: { type: 'integer' },
              outputTokens: { type: 'integer' },
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
      // UI remains answer-only; usage/trace/route are structured diagnostics
      // for benchmark/debug consumers and are not rendered into the conversation.
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const { maxBytes, allowPrivateNetwork } = mediaOptions()
      const hasSingle = args.image !== undefined && args.image.trim().length > 0
      const hasMany = (args.images ?? []).some(ref => ref.trim().length > 0)
      if (hasSingle && hasMany) throw new Error('image-mind: pass either `image` (single) or `images` (array), not both')

      const batchOffset = args.sessionBatchOffset ?? 0
      if (!Number.isSafeInteger(batchOffset) || batchOffset < 0 || batchOffset > MAX_SESSION_BATCH_OFFSET) {
        throw new Error(`image-mind: sessionBatchOffset must be an integer from 0 to ${MAX_SESSION_BATCH_OFFSET}`)
      }
      if ((hasSingle || hasMany) && args.sessionBatchOffset !== undefined) {
        throw new Error('image-mind: sessionBatchOffset is only valid when `image` and `images` are omitted')
      }

      const explicitRawRefs = hasSingle ? [args.image!.trim()] : (args.images ?? []).map(ref => ref.trim())
      if (explicitRawRefs.some(ref => ref.length === 0)) throw new Error('image-mind: image references must be non-empty strings')
      let refs = explicitRawRefs.filter(ref => ref.length > 0)
      let sourceLabels = refs.map(safeImageIdentity)

      if (refs.length === 0) {
        const sessionId = exec.agent?.id
        if (sessionId !== undefined) {
          const sessionRefs = await sessionAttachmentRefsByOffset(ctx, String(sessionId), batchOffset)
          refs = sessionRefs.map(ref => JSON.stringify(ref))
          sourceLabels = sessionRefs.map((_ref, index) => `session-image-${index + 1}`)
        }
      }
      if (refs.length === 0) {
        throw new Error(`image-mind: no complete session image batch exists at offset ${batchOffset}; upload/re-send the image or choose a newer batch`)
      }
      if (refs.length > MAX_IMAGES_PER_REQUEST) throw new Error(`image-mind: at most ${MAX_IMAGES_PER_REQUEST} images per call; got ${refs.length}`)

      const images = await loadImagesConcurrent(ctx, refs, exec.signal, maxBytes, allowPrivateNetwork, MAX_TOTAL_IMAGE_BYTES_FACTOR)
      const callerPrompt = args.prompt ?? defaultPrompt()
      const task = inferVisionTask(callerPrompt, images.length)
      const { maxOutputTokens } = routeVisionTask(task).policy
      const cacheMode = args.cache ?? 'use'
      const explicitRoute = (args.provider?.trim().length ?? 0) > 0 || (args.model?.trim().length ?? 0) > 0
      const useEvidenceLayer = evidenceCache !== undefined
        && !explicitRoute
        && cacheMode !== 'no-store'
        && isReusableEvidenceTask(task)
      const decision: UnderstandImageDecision = {
        task,
        cacheMode,
        evidenceLayerEnabled: useEvidenceLayer,
      }
      const understandingKey = useEvidenceLayer ? reusableEvidenceKey(images, task) : undefined

      if (understandingKey !== undefined && cacheMode === 'use') {
        const hit = evidenceCache!.getUnderstanding(understandingKey)
        if (hit !== undefined) {
          const trace = cacheOnlyTrace()
          return {
            text: hit.facts,
            model: hit.model,
            provider: hit.provider,
            route: understandImageRoute(args, hit.provider, hit.model, decision, trace, 'evidence-cache'),
            images: images.map((image, index) => ({
              source: sourceLabels[index],
              mimeType: image.mimeType,
              bytes: image.bytes.length,
            })),
            trace,
          }
        }
      }

      const requestPrompt = useEvidenceLayer ? reusableEvidencePrompt(task, images.length) : callerPrompt
      const result = await ctx.vision.call({
        provider: args.provider,
        model: args.model,
        prompt: requestPrompt,
        images,
        maxOutputTokens,
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
        route: understandImageRoute(args, result.provider, result.model, decision, result.trace),
        images: images.map((image, index) => ({
          source: sourceLabels[index],
          mimeType: image.mimeType,
          bytes: image.bytes.length,
        })),
        ...result.usage === undefined ? {} : { usage: result.usage },
        ...result.trace === undefined ? {} : { trace: result.trace },
      }
    },
    presentCall: understandImageCallView,
  })
}
