/**
 * Response parsing for OpenAI-compatible vision endpoints: the single text
 * answer out of a chat-completions or responses payload, plus the wire
 * request builders. Pure — no I/O.
 * @module dsh-plugin-image-mind/adapters/openai-compatible/parse
 */

import { ImageMindVisionError } from './adapter.ts'
import type { LoadedImage } from './adapter.ts'
import type { VisionApiStyle } from './types.ts'
import { planVisionPrompt } from '../../runtime/vision-planner.ts'

/** Promise rejection helper shared by both response-shape extractors. */
function unexpectedShape(): never {
  throw new ImageMindVisionError('image-mind: vision endpoint returned an unexpected response shape', 'INVALID_RESPONSE')
}

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Read user-visible text from the common OpenAI-compatible content shapes.
 * Official chat-completions normally returns one string, while several
 * compatible providers return an array of `{type:'text', text:'...'}` parts.
 * Ignore non-text/reasoning/tool parts instead of serializing arbitrary data.
 */
function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content.trim().length > 0 ? content : undefined
  }
  if (!Array.isArray(content)) return undefined

  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      if (item.trim().length > 0) parts.push(item)
      continue
    }
    const block = asRecord(item)
    if (block === undefined) continue
    const type = block.type
    const text = block.text
    if ((type === undefined || type === 'text' || type === 'output_text')
      && typeof text === 'string' && text.trim().length > 0) {
      parts.push(text)
    }
  }
  const joined = parts.join('\n')
  return joined.trim().length > 0 ? joined : undefined
}

/** Extract the single text answer from an OpenAI-compatible chat-completions payload. */
export function extractChatCompletionsContent(payload: unknown): string {
  const root = asRecord(payload)
  const choices = root?.choices
  if (root === undefined || !Array.isArray(choices) || choices.length === 0) unexpectedShape()
  const message = asRecord(asRecord(choices[0])?.message)
  if (message === undefined) unexpectedShape()
  const text = textFromContent(message.content)
  if (text === undefined) {
    throw new ImageMindVisionError('image-mind: vision endpoint returned no text content', 'EMPTY_RESPONSE')
  }
  return text
}

/** Extract the text answer from an OpenAI Responses payload. */
export function extractResponsesContent(payload: unknown): string {
  const root = asRecord(payload)
  if (root === undefined) unexpectedShape()

  // Some compatible Responses endpoints expose the SDK-style convenience
  // field directly even though the canonical API carries message parts.
  const direct = textFromContent(root.output_text)
  if (direct !== undefined) return direct

  const output = root.output
  if (!Array.isArray(output)) unexpectedShape()
  const parts: string[] = []
  for (const item of output) {
    const itemRecord = asRecord(item)
    if (itemRecord === undefined) continue
    const { type, role, content } = itemRecord
    if (type !== 'message' || role !== 'assistant') continue
    const text = textFromContent(content)
    if (text !== undefined) parts.push(text)
  }
  const text = parts.join('\n')
  if (text.trim().length === 0) {
    throw new ImageMindVisionError('image-mind: vision endpoint returned no text content', 'EMPTY_RESPONSE')
  }
  return text
}

/** Build the request the configured style sends: its path and JSON body. */
export function buildVisionRequest(
  baseURL: string,
  model: string,
  apiStyle: VisionApiStyle,
  maxOutputTokens: number,
  prompt: string,
  images: readonly LoadedImage[],
  imageOrdinals?: readonly number[],
  originalImageCount?: number,
): { path: string; body: string } {
  // Keep callers and ctx.vision provider-neutral: task planning is an adapter-
  // side concern, immediately before the request becomes a vendor wire body.
  // The planner is deterministic and adds evidence guidance plus a universal
  // fence against instructions embedded in image pixels. Adapter-internal
  // ordinals preserve original image identity across HTTP-413 split batches.
  const plannedPrompt = planVisionPrompt(prompt, images.length, imageOrdinals, originalImageCount)

  if (apiStyle === 'responses') {
    return {
      path: `${baseURL}/responses`,
      body: JSON.stringify({
        model,
        max_output_tokens: maxOutputTokens,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: plannedPrompt },
            ...images.map(image => ({
              type: 'input_image',
              image_url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
            })),
          ],
        }],
      }),
    }
  }
  return {
    path: `${baseURL}/chat/completions`,
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: plannedPrompt },
          ...images.map(image => ({
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}` },
          })),
        ],
      }],
    }),
  }
}
