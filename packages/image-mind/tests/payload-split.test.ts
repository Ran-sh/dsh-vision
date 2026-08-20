/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'

const image = (n: number) => ({ bytes: Buffer.from([n]), mimeType: 'image/png' as const })

function ok(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })
}

function tooLarge(): Response {
  return new Response('payload too large', { status: 413 })
}

function adapter() {
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: () => ({
      provider: 'p',
      baseURL: 'https://custom.example/v1',
      model: 'vision-model',
      apiStyle: 'chat-completions',
      maxOutputTokens: 256,
      timeoutMs: 10_000,
    }),
    resolveApiKey: async () => '',
    retry: { maxRetries: 0 },
  })
}

function requestParts(call: unknown[]): Array<{ type: string; text?: string }> {
  const init = call[1] as RequestInit
  const body = JSON.parse(String(init.body)) as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }
  return body.messages[0].content
}

function imageCount(call: unknown[]): number {
  return requestParts(call).filter(part => part.type === 'image_url').length
}

function plannedText(call: unknown[]): string {
  return requestParts(call).find(part => part.type === 'text')?.text ?? ''
}

afterEach(() => vi.unstubAllGlobals())

describe('adaptive 413 splitting', () => {
  it('bisects a rejected multi-image request, preserves original labels, and merges evidence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tooLarge())
      .mockResolvedValueOnce(ok('left evidence'))
      .mockResolvedValueOnce(ok('right evidence'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter().call('p', {
      prompt: 'compare the screenshots',
      images: [image(1), image(2), image(3), image(4)],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(call => imageCount(call))).toEqual([4, 2, 2])

    const leftPrompt = plannedText(fetchMock.mock.calls[1])
    const rightPrompt = plannedText(fetchMock.mock.calls[2])
    expect(leftPrompt).toContain('Image 1, Image 2')
    expect(leftPrompt).toContain('original 4-image request')
    expect(rightPrompt).toContain('Image 3, Image 4')
    expect(rightPrompt).toContain('do not renumber this subset from 1')

    expect(result.text).toContain('[Vision split evidence for original Image 1, Image 2 of 4]')
    expect(result.text).toContain('[Vision split evidence for original Image 3, Image 4 of 4]')
    expect(result.text).toContain('left evidence')
    expect(result.text).toContain('right evidence')
  })

  it('recursively preserves labels when a half is split again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tooLarge()) // 4
      .mockResolvedValueOnce(tooLarge()) // original 1,2
      .mockResolvedValueOnce(ok('one'))  // original 1
      .mockResolvedValueOnce(ok('two'))  // original 2
      .mockResolvedValueOnce(ok('right')) // original 3,4
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter().call('p', {
      prompt: 'compare',
      images: [image(1), image(2), image(3), image(4)],
    })

    expect(fetchMock.mock.calls.map(call => imageCount(call))).toEqual([4, 2, 1, 1, 2])
    expect(plannedText(fetchMock.mock.calls[2])).toContain('Image 1 from the original 4-image request')
    expect(plannedText(fetchMock.mock.calls[3])).toContain('Image 2 from the original 4-image request')
    expect(plannedText(fetchMock.mock.calls[4])).toContain('Image 3, Image 4')
    expect(result.text).toContain('original Image 1 of 4')
    expect(result.text).toContain('original Image 2 of 4')
    expect(result.text).toContain('original Image 3, Image 4 of 4')
    expect(result.text).toContain('one')
    expect(result.text).toContain('two')
    expect(result.text).toContain('right')
  })

  it('does not loop when a single image itself exceeds the provider limit', async () => {
    const fetchMock = vi.fn(async () => tooLarge())
    vi.stubGlobal('fetch', fetchMock)

    await expect(adapter().call('p', { prompt: 'read', images: [image(1)] })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
