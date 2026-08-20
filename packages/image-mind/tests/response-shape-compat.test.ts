/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import {
  extractChatCompletionsContent,
  extractResponsesContent,
} from '../src/adapters/openai-compatible/parse.ts'

describe('OpenAI-compatible response text shapes', () => {
  it('keeps the canonical chat string shape', () => {
    expect(extractChatCompletionsContent({
      choices: [{ message: { content: 'plain text' } }],
    })).toBe('plain text')
  })

  it('accepts chat content-part arrays and ignores non-text parts', () => {
    expect(extractChatCompletionsContent({
      choices: [{
        message: {
          content: [
            { type: 'text', text: 'first' },
            { type: 'reasoning', text: 'hidden reasoning' },
            { type: 'text', text: 'second' },
          ],
        },
      }],
    })).toBe('first\nsecond')
  })

  it('accepts a Responses output_text convenience field', () => {
    expect(extractResponsesContent({ output_text: 'direct answer' })).toBe('direct answer')
  })

  it('accepts text/output_text parts inside assistant Responses messages', () => {
    expect(extractResponsesContent({
      output: [{
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'one' },
          { type: 'text', text: 'two' },
          { type: 'reasoning', text: 'not user-visible' },
        ],
      }],
    })).toBe('one\ntwo')
  })

  it('still rejects structurally valid responses that contain no visible text', () => {
    expect(() => extractChatCompletionsContent({
      choices: [{ message: { content: [{ type: 'reasoning', text: 'hidden' }] } }],
    })).toThrow(/no text content/)
  })
})
