/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import { automaticFallbackVisionModels } from '../src/adapters/openai-compatible/discovery.ts'

const image = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

function ok(text = 'seen'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })
}

function incompatible(message = 'model does not support image input'): Response {
  return new Response(message, { status: 400 })
}

function makeAdapter(baseURL: string, configuredModel: string) {
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: (_provider, request) => ({
      provider: 'p',
      baseURL,
      model: request.model?.trim() || configuredModel,
      apiStyle: 'chat-completions',
      maxOutputTokens: 256,
      timeoutMs: 10_000,
      apiKeyEnv: 'KEY',
    }),
    resolveApiKey: async () => 'test-key',
    retry: { maxRetries: 0 },
  })
}

function requestedModels(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)).model as string)
}

afterEach(() => vi.unstubAllGlobals())

describe('automatic vision model fallback', () => {
  it('uses only known-plan ordered candidates', () => {
    expect(automaticFallbackVisionModels('https://opencode.ai/zen/go/v1', 'mimo-v2.5')).toEqual(['kimi-k3'])
    expect(automaticFallbackVisionModels('https://api.commandcode.ai/provider/v1', 'broken', 2)).toEqual([
      'xiaomi/mimo-v2.5',
      'moonshotai/Kimi-K3',
    ])
    expect(automaticFallbackVisionModels('https://custom.example/v1', 'broken')).toEqual([])
  })

  it('falls back when the configured default is model-incompatible', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(incompatible())
      .mockResolvedValueOnce(ok('fallback answer'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = makeAdapter('https://opencode.ai/zen/go/v1', 'text-only-model')

    const result = await adapter.call('p', { prompt: 'describe it', images: [image] })
    expect(result.text).toBe('fallback answer')
    expect(result.model).toBe('mimo-v2.5')
    expect(requestedModels(fetchMock)).toEqual(['text-only-model', 'mimo-v2.5'])
  })

  it('can advance to the second bounded candidate after another compatibility failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(incompatible('model not found'))
      .mockResolvedValueOnce(incompatible('unsupported model'))
      .mockResolvedValueOnce(ok('second fallback'))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = makeAdapter('https://api.commandcode.ai/provider/v1', 'broken')

    const result = await adapter.call('p', { prompt: 'describe it', images: [image] })
    expect(result.model).toBe('moonshotai/Kimi-K3')
    expect(requestedModels(fetchMock)).toEqual(['broken', 'xiaomi/mimo-v2.5', 'moonshotai/Kimi-K3'])
  })

  it('never substitutes an explicit model override', async () => {
    const fetchMock = vi.fn(async () => incompatible())
    vi.stubGlobal('fetch', fetchMock)
    const adapter = makeAdapter('https://opencode.ai/zen/go/v1', 'configured')

    await expect(adapter.call('p', { prompt: 'describe it', images: [image], model: 'user-picked' })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestedModels(fetchMock)).toEqual(['user-picked'])
  })

  it('does not guess fallbacks for an unknown custom endpoint', async () => {
    const fetchMock = vi.fn(async () => incompatible())
    vi.stubGlobal('fetch', fetchMock)
    const adapter = makeAdapter('https://custom.example/v1', 'broken')

    await expect(adapter.call('p', { prompt: 'describe it', images: [image] })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
