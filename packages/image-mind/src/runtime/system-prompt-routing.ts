/**
 * Model-only routing guidance for image-mind.
 *
 * The browser send hook deliberately keeps tool names and attachment metadata
 * out of the user-visible conversation text. This section tells the main DSH
 * model how to interpret the neutral attachment marker and how to invoke the
 * tool using the host-side session attachment index.
 */

import type { Context } from '@deepseek-ai/cordis'

interface SystemPromptSectionFace {
  section(input: { name: string; order: number; text: string }): () => void
}

export const IMAGE_MIND_ROUTING_SECTION = Object.freeze({
  name: 'tool:image-mind',
  order: 150,
  text: [
    'Image-mind can inspect images through the `understand_image` tool.',
    'A user message ending with the neutral marker “已附加图片。” or “已附加 N 张图片。” means that image bytes are stored server-side for the current DSH session; the marker itself contains no visual evidence.',
    'When the answer depends on those images, call `understand_image` before answering. For the current uploaded batch, omit `image` and `images` and pass a precise `prompt` describing the user’s visual question.',
    'Never infer image contents from the attachment marker alone. If the user explicitly asks to inspect the pixels again or verify a detail afresh, use `cache: "refresh"`.',
  ].join(' '),
})

/**
 * Register the hidden routing section through the DSH system-prompt service.
 * The production plugin declares `systemPrompt` in `inject`, so a real Cordis
 * composition will not activate until this service exists. Direct unit-test
 * fixtures sometimes call `apply()` without running dependency injection;
 * those fixtures may safely omit the section and test their narrower concern.
 */
export function registerImageMindSystemPrompt(ctx: Context): boolean {
  const systemPrompt = (ctx as unknown as { systemPrompt?: SystemPromptSectionFace }).systemPrompt
  if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') return false
  systemPrompt.section(IMAGE_MIND_ROUTING_SECTION)
  return true
}
