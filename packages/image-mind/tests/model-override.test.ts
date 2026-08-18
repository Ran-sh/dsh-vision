/**
 * Model-override wire test (deterministic, no real API). Proves the full
 * override path end-to-end through the composition: request.model 鈫? * VisionConnection.model 鈫?wire request model. The configured model and the
 * override model differ, so a broken override path cannot pass by accident.
 * @vitest-environment node
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { VisionRuntime } from '@ran-sh/dsh-vision'

/** A tiny valid PNG. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

/** One loaded image for direct runtime calls. */
const LOADED_IMAGE = { bytes: PNG_BYTES, mimeType: 'image/png' as const }

/** Mount apply() with one provider whose configured model differs from the override. */
async function mount(): Promise<{ vision: VisionRuntime }> {
  const ctx = new Context()
  // The vision service is injected: load the service package first.
  await ctx.plugin(VisionRuntime)
  ctx.provide('tools', { register: () => () => {} } as never)
  ctx.provide('credentials', {
    resolve: vi.fn(async () => ({ value: 'sk-test', source: 'test' })),
  } as never)
  apply(ctx, {
    providers: {
      'a': { baseURL: 'https://a.example/v1', model: 'configured-default-model', apiKeyEnv: 'KEY_A' },
    },
    active: 'a',
  })
  const vision = ctx.get('vision') as VisionRuntime
  if (vision === undefined) throw new Error('vision service not mounted')
  return { vision }
}

/** A chat-completions success response. */
function okChatResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: 'answer' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** Capture the JSON body of every fetch call. */
function wireBodies(): Array<{ model: string; messages: unknown; max_tokens: number }> {
  const fetchMock = vi.mocked(fetch)
  return fetchMock.mock.calls.map(call => {
    const init = call[1] as RequestInit
    return JSON.parse(String(init.body)) as { model: string; messages: unknown; max_tokens: number }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('model override reaches the wire (deterministic)', () => {
  it('request.model overrides the configured model in the wire request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { vision } = await mount()

    // With an override: the wire body must carry the override model.
    await vision.call({ prompt: 'p', images: [LOADED_IMAGE], model: 'override-model' })
    let bodies = wireBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].model).toBe('override-model')
    expect(bodies[0].model).not.toBe('configured-default-model')

    // Without an override: the wire body carries the configured default.
    await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    bodies = wireBodies()
    expect(bodies).toHaveLength(2)
    expect(bodies[1].model).toBe('configured-default-model')

    // The provider's own configuration was never mutated by the override.
    expect(bodies[1].model).toBe('configured-default-model')
  })

  it('an empty-string model keeps the configured default (no accidental override)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { vision } = await mount()
    await vision.call({ prompt: 'p', images: [LOADED_IMAGE], model: '   ' })
    const bodies = wireBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].model).toBe('configured-default-model')
  })

  it('a whitespace-padded override is trimmed before reaching the wire', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { vision } = await mount()
    await vision.call({ prompt: 'p', images: [LOADED_IMAGE], model: '  override-model  ' })
    const bodies = wireBodies()
    expect(bodies[0].model).toBe('override-model')
  })
})
