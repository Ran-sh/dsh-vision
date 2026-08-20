/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractVisionUsage } from '../src/adapters/openai-compatible/parse.ts'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'

const image = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

function makeAdapter(apiStyle: 'chat-completions' | 'responses') {
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: () => ({
      provider: 'p',
      baseURL: 'https://example.test/v1',
      model: 'vision',
      apiStyle,
      maxOutputTokens: 256,
      timeoutMs: 10_000,
    }),
    resolveApiKey: async () => 'key',
    retry: { maxRetries: 0 },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('vision usage parsing', () => {
  it('normalizes chat-completions token counters', () => {
    expect(extractVisionUsage({ usage: { prompt_tokens: 321, completion_tokens: 45 } }, 'chat-completions')).toEqual({
      inputTokens: 321,
      outputTokens: 45,
    })
  })

  it('normalizes responses token counters and rejects malformed values', () => {
    expect(extractVisionUsage({ usage: { input_tokens: 777, output_tokens: 88 } }, 'responses')).toEqual({
      inputTokens: 777,
      outputTokens: 88,
    })
    expect(extractVisionUsage({ usage: { input_tokens: -1, output_tokens: 1.5 } }, 'responses')).toBeUndefined()
  })
})

describe('vision usage propagation', () => {
  it('returns chat-completions usage on VisionResult', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'seen' } }],
      usage: { prompt_tokens: 123, completion_tokens: 17 },
    }), { status: 200 })))

    const result = await makeAdapter('chat-completions').call('p', { prompt: 'describe', images: [image] })
    expect(result.usage).toEqual({ inputTokens: 123, outputTokens: 17 })
  })

  it('returns responses usage on VisionResult', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output_text: 'seen',
      usage: { input_tokens: 456, output_tokens: 31 },
    }), { status: 200 })))

    const result = await makeAdapter('responses').call('p', { prompt: 'describe', images: [image] })
    expect(result.usage).toEqual({ inputTokens: 456, outputTokens: 31 })
  })

  it('sums usage across adaptive 413 split children', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('too large', { status: 413 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'left' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'right' } }],
        usage: { prompt_tokens: 110, completion_tokens: 11 },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeAdapter('chat-completions').call('p', {
      prompt: 'compare',
      images: [image, image],
    })
    expect(result.usage).toEqual({ inputTokens: 210, outputTokens: 21 })
  })
})
