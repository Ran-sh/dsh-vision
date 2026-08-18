/**
 * Composition integration tests: `apply()` (src/index.ts) wired against a
 * real VisionRuntime with stubbed tool/webserver services and a stubbed
 * credential seam, plus a mocked fetch so real calls complete end-to-end.
 * Covers the zero-provider, multi-provider, active-provider, catalog-provider,
 * and model-override scenarios the runtime unit tests cannot reach.
 * @vitest-environment node
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import type { Config } from '../src/config.ts'
import { VISION_PROVIDER_CATALOG } from '../src/providers/catalog.ts'
import { VisionRuntime } from '@ran-sh/dsh-vision'

/** A tiny valid PNG for image loading. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

/** Write a temp PNG and return its path. */
function tempImage(): string {
  const { writeFileSync, mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-int-'))
  const file = join(dir, 'img.png')
  writeFileSync(file, PNG_BYTES)
  return file
}

/** A chat-completions success response the mocked fetch returns. */
function okChatResponse(): Response {
  const body = JSON.stringify({ choices: [{ message: { content: 'vision answer' } }] })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

/** Mount apply() with a stubbed tool registry and a credential seam. */
async function mount(config: Config): Promise<{ ctx: Context; vision: VisionRuntime; executeTool: (args: Record<string, unknown>) => Promise<unknown> }> {
  const ctx = new Context()
  // The vision service is injected (inject: ['vision']): load the real
  // service package first, exactly as a composition would (vision-runtime
  // row before image-mind row).
  await ctx.plugin(VisionRuntime)
  // Stub the tool registry (captures the registered tool for direct execution).
  let tool: { execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown> } | undefined
  ctx.provide('tools', {
    register: vi.fn((definition: { execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown> }) => {
      tool = definition
      return () => {}
    }),
  } as never)
  // Stub the credential seam: every referenced key resolves (the settings
  // card would have stored them; here they are pre-populated).
  const keys = new Map<string, string>([
    ['KEY_A', 'sk-a'],
    ['KEY_B', 'sk-b'],
    ['CUSTOM_KEY', 'sk-custom'],
  ])
  ctx.provide('credentials', {
    resolve: vi.fn(async (ref: { toString(): string }) => {
      const value = keys.get(String(ref))
      return value === undefined ? undefined : { value, source: 'test' }
    }),
    set: vi.fn(async (ref: { toString(): string }, value: string) => { keys.set(String(ref), value) }),
  } as never)
  apply(ctx, config)
  const vision = ctx.get('vision')
  if (vision === undefined) throw new Error('vision service not mounted')
  return {
    ctx,
    vision: vision as VisionRuntime,
    executeTool: async (args) => {
      if (tool === undefined) throw new Error('no tool registered')
      return tool.execute(args, { signal: new AbortController().signal })
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** One loaded image for direct runtime calls (bypasses the tool's file load). */
const LOADED_IMAGE = { bytes: PNG_BYTES, mimeType: 'image/png' as const }

describe('composition integration (apply + VisionRuntime)', () => {
  it('A: a plugin with zero providers applies successfully', async () => {
    const { vision } = await mount({})
    expect(vision.hasProvider('a')).toBe(false)
    expect(vision.listProviders()).toHaveLength(0)
  })

  it('B: zero providers 鈫?first call fails PROVIDER_NOT_FOUND', async () => {
    const { vision } = await mount({})
    await expect(vision.call({ prompt: 'p', images: [LOADED_IMAGE] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
  })

  it('C: two providers + active A 鈫?omitted provider uses A', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { vision } = await mount(twoProviderConfig('a'))
    const result = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(result.provider).toBe('a')
    expect(result.model).toBe('model-a')
  })

  it('D: change active A 鈫?B 鈫?the next call uses B', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { vision } = await mount(twoProviderConfig('a'))
    const first = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(first.provider).toBe('a')
    // Re-mount with active b: a fresh composition (settings changes re-run
    // the same ensureRegistration path in a live mount; here we simulate the
    // resolved().active source changing by re-applying a new config).
    const { vision: visionB } = await mount(twoProviderConfig('b'))
    const second = await visionB.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(second.provider).toBe('b')
    expect(second.model).toBe('model-b')
  })

  it('E: a catalog provider configured → no DUPLICATE_PROVIDER, directory has one copy', async () => {
    const { vision } = await mount(catalogAndCustomConfig())
    // The catalog owns opencode-go; the user directory must not re-declare it.
    const ids = vision.listDirectory().map(entry => entry.id)
    expect(ids.filter(id => id === 'opencode-go')).toHaveLength(1)
    expect(ids).toContain('my-custom')
    // The catalog's other entries survive.
    expect(ids).toContain('commandcode-goat')
  })

  it('F: catalog + custom provider → directory has catalog + custom, custom is live', async () => {
    const { vision } = await mount(catalogAndCustomConfig())
    expect(vision.hasProvider('opencode-go')).toBe(true)
    expect(vision.hasProvider('my-custom')).toBe(true)
    expect(vision.getProvider('my-custom')?.displayName).toBe('my-custom')
  })

  it('G/H: delete all providers → routes empty; add again → routes recover', async () => {
    // G: mount with two providers, then re-mount with zero (settings change
    // to empty) —the same ensureRegistration path that handles live changes.
    const { vision } = await mount(twoProviderConfig('a'))
    expect(vision.hasProvider('a')).toBe(true)
    const { vision: emptied } = await mount({})
    expect(emptied.hasProvider('a')).toBe(false)
    expect(emptied.hasProvider('b')).toBe(false)
    // H: recover with a provider again.
    const { vision: recovered } = await mount(twoProviderConfig('a'))
    expect(recovered.hasProvider('a')).toBe(true)
    expect(recovered.hasProvider('b')).toBe(true)
  })

  it('I: model override reaches the adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { vision } = await mount(twoProviderConfig('a'))
    const overridden = await vision.call({ prompt: 'p', images: [LOADED_IMAGE], model: 'override-model' })
    expect(overridden.model).toBe('override-model')
    // The next call without an override uses the configured default again.
    const plain = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(plain.model).toBe('model-a')
  })

  it('J: discover explicit B while active A 鈫?B connection facts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ data: [{ id: 'b-model' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const { vision } = await mount(twoProviderConfig('a'))
    const models = await vision.discoverModels({ provider: 'b' })
    // The fetch URL must point at B's endpoint —capture what the adapter asked.
    const fetchMock = vi.mocked(fetch)
    const urls = fetchMock.mock.calls.map(call => String(call[0]))
    expect(urls.some(url => url.startsWith('https://b.example/v1/models'))).toBe(true)
    expect(urls.some(url => url.startsWith('https://a.example/v1/models'))).toBe(false)
    expect(models.some(model => model.id === 'b-model')).toBe(true)
  })
})

/** A config with two providers and the given active. */
function twoProviderConfig(active: string): Config {
  return {
    providers: {
      'a': { baseURL: 'https://a.example/v1', model: 'model-a', apiKeyEnv: 'KEY_A' },
      'b': { baseURL: 'https://b.example/v1', model: 'model-b', apiKeyEnv: 'KEY_B' },
    },
    active,
  }
}

/** A config with one catalog provider (opencode-go) and one custom provider. */
function catalogAndCustomConfig(): Config {
  const catalog = VISION_PROVIDER_CATALOG.find(entry => entry.id === 'opencode-go')!
  return {
    providers: {
      'opencode-go': { baseURL: catalog.baseURL, model: catalog.defaultModel, apiKeyEnv: catalog.apiKeyEnv },
      'my-custom': { baseURL: 'https://custom.example/v1', model: 'custom-model', apiKeyEnv: 'CUSTOM_KEY' },
    },
    active: 'opencode-go',
  }
}
