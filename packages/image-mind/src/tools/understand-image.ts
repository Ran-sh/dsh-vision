/**
 * The `understand_image` tool: a thin consumer of `ctx.vision`. It loads one
 * or more images (media layer) and hands the request to the runtime — it
 * never touches baseURL, apiKey, apiStyle, timeout, fetch, protocol selection,
 * model discovery, or retry policy. Provider and model defaults are resolved
 * by the runtime from its own provider registration. The image never enters
 * the conversation: only the returned text crosses.
 *
 * Multi-image: pass `images` (up to `maxImagesPerRequest`, default 4) for
 * compare/diff/batch tasks — the request carries all of them to the vision
 * model in one call. The legacy single `image` argument remains fully
 * supported; both normalize to the same `LoadedImage[]`.
 * @module dsh-plugin-image-mind/tools/understand-image
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'
import { loadImage } from '../media/load.ts'
import type { LoadedImage } from '../media/types.ts'
// The `ctx.vision` Context augmentation, owned by the vision service package.
import type {} from '@ran-sh/dsh-vision'

/** Upper bound on images one call may carry (payload/cost guard). */
export const MAX_IMAGES_PER_REQUEST = 4

/** Total-byte bound across all images: 2x the single-image cap. */
export const MAX_TOTAL_IMAGE_BYTES_FACTOR = 2

/**
 * Load several images with bounded concurrency (2), preserving input order
 * and sharing one AbortSignal; the summed byte bound is enforced before any
 * provider request.
 */
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
  // A failure in one worker (size bound, missing file, abort) must stop the
  // others from continuing pointless network/file work: chain an internal
  // abort onto the caller's signal and reject on the first error.
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
        if (total > totalCap) {
          throw new Error(`image-mind: combined image size exceeds the ${totalCap}-byte bound`)
        }
        images[index] = image
      } catch (error) {
        failures.push(error)
        internal.abort() // Stop the sibling worker's in-flight load.
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

/**
 * A safe identity for one image in the model-facing result: never a full
 * local path, never a URL with a query string. Local refs become the
 * basename; URLs become `host/...`; anything else stays opaque.
 */
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

/** The understand_image call's validated arguments. */
export interface UnderstandImageArgs {
  /** Single image: local path, http(s) URL, attachment JSON, or bare attachment id. */
  image?: string
  /** Multiple images for compare/diff/batch tasks; mutually exclusive with `image`. */
  images?: string[]
  prompt?: string
  provider?: string
  /** Model id override; absent uses the provider's configured default. */
  model?: string
}

/**
 * Pure call view: a generic read card, with file locations for local paths.
 * @param args - the validated call arguments.
 * @returns the pending-state card for one understand_image call.
 */
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

/** The `understand_image` tool definition. */
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
    + 'Do NOT re-call this tool for an image whose analysis already appears in the conversation, unless '
    + 'the user asks for a fresh look.'

  return defineTool({
    name: 'understand_image',
    description: DESCRIPTION_HEAD
      + 'Each image may be a local path, an http(s) URL, the JSON object from an `[image attachment …]` '
      + "note, or — the common case when the user sent an image through this plugin's input rewriting — a "
      + 'short markdown image reference like `![图片](/image-mind/raw/sha256:abc…)` pasted into '
      + 'the conversation. In the markdown form, take the attachment id from the URL and pass that id '
      + 'as the `image`/`images` value (never the whole markdown, and never a made-up path); the tool '
      + 'resolves the id to the stored image. The images themselves never enter the conversation — only '
      + 'the returned text is shown to you.',
    parameters: {
      image: {
        type: 'string',
        description: 'REQUIRED unless `images` is passed. Absolute path to a local image file, an http(s) URL of the image, the JSON object from an [image attachment …] note, or the bare attachment id (e.g. sha256:abc…) taken from the markdown image reference ![图片](/image-mind/raw/<id>) that appeared in the conversation. Use this for a single image; for several images pass `images` instead.',
      },
      images: {
        type: 'array',
        items: { type: 'string' },
        description: `REQUIRED unless \`image\` is passed. Several image references (local paths, http(s) URLs, attachment ids) to analyze together — for comparing screenshots, diffing before/after, or batch-reading a page of photos. At most ${MAX_IMAGES_PER_REQUEST}. Mutually exclusive with \`image\`.`,
      },
      prompt: {
        type: 'string',
        description: 'Your precise instruction for the vision model about the image(s) (e.g. "transcribe all text", "extract the table as CSV", "diagnose the UI problems", "compare the two screenshots and list the differences", "translate the text"). Prefer a targeted prompt over the generic default description.',
      },
      provider: {
        type: 'string',
        description: 'Optional configured vision-provider id to use for this call; defaults to the active provider.',
      },
      model: {
        type: 'string',
        description: 'Optional model id override for this call; absent uses the provider\'s configured default model.',
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
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const { maxBytes, allowPrivateNetwork } = mediaOptions()
      // Mutual exclusion: `image` and `images` are documented as alternatives;
      // passing both is a caller bug and must fail loudly, never silently
      // prefer one (the caller would believe all images were sent).
      const hasSingle = args.image !== undefined && args.image.trim().length > 0
      const hasMany = (args.images ?? []).some(ref => ref.trim().length > 0)
      if (hasSingle && hasMany) {
        throw new Error('image-mind: pass either `image` (single) or `images` (array), not both')
      }
      const rawRefs = hasSingle ? [args.image!.trim()] : (args.images ?? []).map(ref => ref.trim())
      // Empty strings inside the array are invalid, not silently dropped.
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
      // Load with bounded concurrency (2) while preserving input order; a
      // shared AbortSignal cancels all in-flight loads together. The total
      // byte bound is enforced BEFORE any provider request, so a huge
      // multi-image payload can never reach the wire.
      const images = await loadImagesConcurrent(ctx, refs, exec.signal, maxBytes, allowPrivateNetwork, MAX_TOTAL_IMAGE_BYTES_FACTOR)
      // The runtime selects the provider (explicit `provider`, else active),
      // resolves the connection snapshot, and dispatches to the adapter.
      const result = await ctx.vision.call({
        provider: args.provider,
        model: args.model,
        prompt: args.prompt ?? defaultPrompt(),
        images,
        signal: exec.signal,
      })
      // The model-facing result never echoes full local paths or URL query
      // strings: it reports a safe identity (basename or host + opaque index).
      return {
        text: result.text,
        model: result.model,
        provider: result.provider,
        images: images.map((image, index) => ({
          source: safeImageIdentity(refs[index]),
          mimeType: image.mimeType,
          bytes: image.bytes.length,
        })),
      }
    },
    presentCall: understandImageCallView,
  })
}
