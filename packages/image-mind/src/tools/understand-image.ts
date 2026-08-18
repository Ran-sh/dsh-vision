/**
 * The `understand_image` tool: a thin consumer of `ctx.vision`. It loads one
 * image (media layer) and hands the request to the runtime — it never touches
 * baseURL, apiKey, apiStyle, timeout, fetch, protocol selection, model
 * discovery, or retry policy. Provider and model defaults are resolved by the
 * runtime from its own provider registration. The image never enters the
 * conversation: only the returned text crosses.
 * @module dsh-plugin-image-mind/tools/understand-image
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'
import { loadImage } from '../media/load.ts'
// The `ctx.vision` Context augmentation, owned by the vision service package.
import type {} from '@ran-sh/dsh-vision'

/** The understand_image call's validated arguments. */
export interface UnderstandImageArgs {
  image: string
  prompt?: string
  provider?: string
  /** Model id override; absent uses the provider's configured default. */
  model?: string
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

/** The `understand_image` tool definition. */
export function understandImageTool(
  ctx: Context,
  defaultPrompt: () => string,
  mediaOptions: () => { maxBytes: number; allowPrivateNetwork: boolean },
): ReturnType<typeof defineTool> {
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

  return defineTool({
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
          image: { type: 'string', required: true },
          mimeType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const { maxBytes, allowPrivateNetwork } = mediaOptions()
      const image = await loadImage(ctx, args.image, exec.signal, maxBytes, { allowPrivateNetwork })
      // The runtime selects the provider (explicit `provider`, else active),
      // resolves the connection snapshot, and dispatches to the adapter.
      const result = await ctx.vision.call({
        provider: args.provider,
        model: args.model,
        prompt: args.prompt ?? defaultPrompt(),
        images: [image],
        signal: exec.signal,
      })
      return {
        text: result.text,
        model: result.model,
        provider: result.provider,
        image: args.image,
        mimeType: image.mimeType,
        bytes: image.bytes.length,
      }
    },
    presentCall: understandImageCallView,
  })
}
