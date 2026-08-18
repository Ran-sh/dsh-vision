/**
 * Response parsing for OpenAI-compatible vision endpoints: the single text
 * answer out of a chat-completions or responses payload, plus the wire
 * request builders. Pure — no I/O.
 * @module dsh-plugin-image-mind/adapters/openai-compatible/parse
 */

import { ImageMindVisionError } from './adapter.ts'
import type { LoadedImage } from './adapter.ts'
import type { VisionApiStyle } from './types.ts'

/** Promise rejection helper shared by both response-shape extractors. */
function unexpectedShape(): never {
  throw new ImageMindVisionError('image-mind: vision endpoint returned an unexpected response shape', 'INVALID_RESPONSE')
}

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Extract the single text answer from an OpenAI-compatible chat-completions payload. */
export function extractChatCompletionsContent(payload: unknown): string {
  const root = asRecord(payload)
  const choices = root?.choices
  if (root === undefined || !Array.isArray(choices) || choices.length === 0) unexpectedShape()
  const message = asRecord(asRecord(choices[0])?.message)
  const content = message?.['content']
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ImageMindVisionError('image-mind: vision endpoint returned no text content', 'EMPTY_RESPONSE')
  }
  return content
}

/** Extract the text answer from an OpenAI Responses payload: every `output_text` part of assistant messages. */
export function extractResponsesContent(payload: unknown): string {
  const root = asRecord(payload)
  const output = root?.output
  if (root === undefined || !Array.isArray(output)) unexpectedShape()
  const parts: string[] = []
  for (const item of output) {
    const itemRecord = asRecord(item)
    if (itemRecord === undefined) continue
    const { type, role, content } = itemRecord
    if (type !== 'message' || role !== 'assistant' || !Array.isArray(content)) continue
    for (const part of content) {
      const block = asRecord(part)
      if (block === undefined) continue
      if (block.type === 'output_text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        parts.push(block.text)
      }
    }
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
  image: LoadedImage,
): { path: string; body: string } {
  const dataUrl = `data:${image.mimeType};base64,${image.bytes.toString('base64')}`
  if (apiStyle === 'responses') {
    return {
      path: `${baseURL}/responses`,
      body: JSON.stringify({
        model,
        max_output_tokens: maxOutputTokens,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl },
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
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
    }),
  }
}
