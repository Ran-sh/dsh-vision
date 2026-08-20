/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import type { VisionRequest } from '@ran-sh/dsh-vision'

const IMAGE = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }
const REQUEST: VisionRequest = { prompt: 'read this', images: [IMAGE] }

function ok(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })
}

function failing(status: number, text = 'failed'): Response {
  return new Response(text, { status })
}

function adapter() {
  return new OpenAICompatibleVisionAdapter({
    resolveProviderOptions: (provider) => ({
      provider,
      baseURL: `https://${provider}.example/v1`,
      model: 'vision-model',
      apiStyle: 'chat-completions',
      maxOutputTokens: 256,
      timeoutMs: 10_000,
    }),
    resolveApiKey: async () => '',
    resolveProviderFallbacks: () => ['backup-a', 'backup-b'],
    retry: { maxRetries: 0 },
  })
}

function calledHost(call: unknown[]): string {
  return new URL(String(call[0])).hostname
}

afterEach(() => vi.unstubAllGlobals())

describe('cross-provider recovery', () => {
  it('moves to the first backup after an exhausted endpoint 5xx', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failing(503, 'temporarily unavailable'))
      .mockResolvedValueOnce(ok('backup evidence'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter().call('primary', REQUEST)

    expect(result.text).toBe('backup evidence')
    expect(result.provider).toBe('backup-a')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(calledHost)).toEqual(['primary.example', 'backup-a.example'])
  })

  it('continues to a second backup only for another recoverable endpoint failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failing(503))
      .mockResolvedValueOnce(failing(429))
      .mockResolvedValueOnce(ok('second backup'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter().call('primary', REQUEST)
    expect(result.provider).toBe('backup-b')
    expect(fetchMock.mock.calls.map(calledHost)).toEqual(['primary.example', 'backup-a.example', 'backup-b.example'])
  })

  it('does not reroute an explicit provider request', async () => {
    const fetchMock = vi.fn(async () => failing(503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(adapter().call('primary', { ...REQUEST, provider: 'primary' })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not hide auth or deterministic 4xx failures behind another provider', async () => {
    const authFetch = vi.fn(async () => failing(401, 'bad key'))
    vi.stubGlobal('fetch', authFetch)
    await expect(adapter().call('primary', REQUEST)).rejects.toThrow()
    expect(authFetch).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
    const badRequestFetch = vi.fn(async () => failing(400, 'invalid request format'))
    vi.stubGlobal('fetch', badRequestFetch)
    await expect(adapter().call('primary', REQUEST)).rejects.toThrow()
    expect(badRequestFetch).toHaveBeenCalledTimes(1)
  })

  it('does not turn a model-compatibility error into cross-provider traffic', async () => {
    const fetchMock = vi.fn(async () => failing(400, 'model does not support image input'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(adapter().call('primary', REQUEST)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
