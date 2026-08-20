/**
 * Response parsing for OpenAI-compatible vision endpoints: answer text,
 * provider-reported token usage, and pure wire request builders.
 */

import { inferVisionTask, routeVisionTask } from '@ran-sh/dsh-vision'
import { ImageMindVisionError } from './adapter.ts'
import type { LoadedImage } from './adapter.ts'
import type { VisionApiStyle } from './types.ts'
import { planVisionPrompt } from '../../runtime/vision-planner.ts'

function unexpectedShape(): never {
  throw new ImageMindVisionError('image-mind: vision endpoint returned an unexpected response shape', 'INVALID_RESPONSE')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

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

export function extractResponsesContent(payload: unknown): string {
  const root = asRecord(payload)
  if (root === undefined) unexpectedShape()

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

/** A provider-neutral token-usage shape matching VisionResult.usage. */
export interface ParsedVisionUsage {
  inputTokens?: number
  outputTokens?: number
}

/** Accept only trustworthy non-negative integer token counters. */
function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Normalize the two common OpenAI-compatible usage vocabularies.
 * Missing/malformed counters stay absent — never estimate token usage.
 */
export function extractVisionUsage(payload: unknown, apiStyle: VisionApiStyle): ParsedVisionUsage | undefined {
  const root = asRecord(payload)
  const usage = asRecord(root?.usage)
  if (usage === undefined) return undefined

  const inputTokens = apiStyle === 'responses'
    ? tokenCount(usage.input_tokens) ?? tokenCount(usage.prompt_tokens)
    : tokenCount(usage.prompt_tokens) ?? tokenCount(usage.input_tokens)
  const outputTokens = apiStyle === 'responses'
    ? tokenCount(usage.output_tokens) ?? tokenCount(usage.completion_tokens)
    : tokenCount(usage.completion_tokens) ?? tokenCount(usage.output_tokens)

  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return {
    ...inputTokens === undefined ? {} : { inputTokens },
    ...outputTokens === undefined ? {} : { outputTokens },
  }
}

export type OpenAIImageDetail = 'low' | 'auto' | 'high' | 'original'

/** Only the official OpenAI endpoint receives OpenAI-specific detail fields. */
function isOfficialOpenAIEndpoint(baseURL: string): boolean {
  try {
    const url = new URL(baseURL)
    return url.protocol === 'https:'
      && url.hostname === 'api.openai.com'
      && url.pathname.replace(/\/+$/, '') === '/v1'
  } catch {
    return false
  }
}

/**
 * Map provider-neutral task intent onto the official OpenAI image-detail
 * vocabulary without leaking that vendor-specific field to compatible APIs.
 * GPT-5.6 high-detail tasks use `original`; older models retain `high`.
 */
export function openAIImageDetailForRequest(
  baseURL: string,
  model: string,
  prompt: string,
  imageCount: number,
): OpenAIImageDetail | undefined {
  if (!isOfficialOpenAIEndpoint(baseURL)) return undefined
  const detail = routeVisionTask(inferVisionTask(prompt, imageCount)).policy.detail
  if (detail === 'low') return 'low'
  if (detail === 'medium') return 'auto'
  return /^gpt-5\.6(?:$|[-.])/i.test(model) ? 'original' : 'high'
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
  const plannedPrompt = planVisionPrompt(prompt, images.length, imageOrdinals, originalImageCount)
  const detail = openAIImageDetailForRequest(baseURL, model, prompt, originalImageCount ?? images.length)

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
              ...(detail === undefined ? {} : { detail }),
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
            image_url: {
              url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
              ...(detail === undefined ? {} : { detail }),
            },
          })),
        ],
      }],
    }),
  }
}
