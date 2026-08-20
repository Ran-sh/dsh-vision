/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { buildVisionRequest, openAIImageDetailForRequest } from '../src/adapters/openai-compatible/parse.ts'

const image = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

describe('official OpenAI image detail policy', () => {
  it('never leaks OpenAI-specific detail fields to compatible endpoints', () => {
    expect(openAIImageDetailForRequest(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'qwen-vl-max',
      'OCR all visible text',
      1,
    )).toBeUndefined()

    const body = JSON.parse(buildVisionRequest(
      'https://example.com/v1',
      'vision-model',
      'chat-completions',
      1000,
      'OCR all visible text',
      [image],
    ).body)
    expect(body.messages[0].content[1].image_url).toEqual({
      url: `data:image/png;base64,${image.bytes.toString('base64')}`,
    })
  })

  it('uses original detail for GPT-5.6 quality-first OCR/UI work', () => {
    expect(openAIImageDetailForRequest(
      'https://api.openai.com/v1',
      'gpt-5.6-sol',
      'transcribe every visible word exactly',
      1,
    )).toBe('original')
    expect(openAIImageDetailForRequest(
      'https://api.openai.com/v1/',
      'gpt-5.6',
      'diagnose this UI layout',
      1,
    )).toBe('original')
  })

  it('keeps high detail for older OpenAI vision models and low for photos', () => {
    expect(openAIImageDetailForRequest(
      'https://api.openai.com/v1',
      'gpt-4o',
      'OCR the receipt verbatim',
      1,
    )).toBe('high')
    expect(openAIImageDetailForRequest(
      'https://api.openai.com/v1',
      'gpt-4o',
      'describe this photo',
      1,
    )).toBe('low')
    expect(openAIImageDetailForRequest(
      'https://api.openai.com/v1',
      'gpt-4o',
      'what is happening here?',
      1,
    )).toBe('auto')
  })

  it('writes detail in both Responses and Chat Completions official wire shapes', () => {
    const responses = JSON.parse(buildVisionRequest(
      'https://api.openai.com/v1',
      'gpt-5.6-terra',
      'responses',
      2000,
      'extract text exactly',
      [image],
    ).body)
    expect(responses.input[0].content[1]).toMatchObject({ type: 'input_image', detail: 'original' })

    const chat = JSON.parse(buildVisionRequest(
      'https://api.openai.com/v1',
      'gpt-4o',
      'chat-completions',
      2000,
      'describe this photo',
      [image],
    ).body)
    expect(chat.messages[0].content[1].image_url).toMatchObject({ detail: 'low' })
  })
})
