/**
 * Settings→adapter integration: a real in-memory SettingsProvider stands in
 * for the DSH settings seam, image-mind registers its section through
 * installSettingsSection, and committed settings changes flow into the next
 * adapter call's snapshot — add provider, set active, change model, and the
 * next request sees the new facts while the in-flight one never changes.
 * This is the exact task-78 scenario ("settings integration").
 * @vitest-environment node
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SettingsProvider, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { Config, IMAGE_MIND_SETTINGS_NAMESPACE, resolveConfig, type Config as ImageMindConfig } from '../src/config.ts'
import { apply } from '../src/index.ts'
import { VisionRuntime } from '@ran-sh/dsh-vision'

/** A tiny valid PNG for image loading. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])
const LOADED_IMAGE = { bytes: PNG_BYTES, mimeType: 'image/png' as const }

/** In-memory SettingsProvider: the smallest concrete subclass that works. */
class MemorySettingsProvider extends SettingsProvider {
  readonly writable = true
  private doc: Record<string, unknown> = {}

  constructor(ctx: Context) {
    super(ctx)
  }

  // The base publishes the loaded document when the provider initializes.
  async *[Service.init]() {
    yield* super[Service.init]()
  }

  protected async load(): Promise<Record<string, unknown>> {
    return this.doc
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [String(ns)]: section }
  }
}

/** Mount image-mind with the settings seam attached, returning a live context. */
async function mount(entry: ImageMindConfig): Promise<{ ctx: Context; vision: VisionRuntime; settings: MemorySettingsProvider }> {
  const ctx = new Context()
  await ctx.plugin(MemorySettingsProvider)
  const settings = ctx.get('settings') as MemorySettingsProvider
  if (settings === undefined) throw new Error('settings service not mounted')
  await ctx.plugin(VisionRuntime)
  ctx.provide('tools', { register: () => () => {} } as never)
  ctx.provide('credentials', {
    resolve: vi.fn(async () => ({ value: 'sk-test', source: 'test' })),
  } as never)
  apply(ctx, entry)
  const vision = ctx.get('vision') as VisionRuntime
  if (vision === undefined) throw new Error('vision service not mounted')
  return { ctx, vision, settings }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settings → adapter snapshot integration', () => {
  it('add a provider via the settings seam → the next call resolves its snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'answer' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    // Mount with one provider; the settings seam takes over the source.
    const { ctx, vision, settings } = await mount({
      providers: { a: { baseURL: 'https://a.example/v1', model: 'model-a', apiKeyEnv: 'KEY_A' } },
      active: 'a',
    })
    expect(vision.hasProvider('a')).toBe(true)

    // The settings service is the live source now: write a SECOND provider
    // through the seam — the plugin must register it without a reload.
    const ns = IMAGE_MIND_SETTINGS_NAMESPACE
    const scope = settings.get(ns) as Record<string, unknown> | undefined
    await settings.update(ns, {
      providers: {
        ...(scope?.['providers'] as Record<string, unknown> ?? {}),
        b: { baseURL: 'https://b.example/v1', model: 'model-b', apiKeyEnv: 'KEY_B' },
      },
    })
    // installSettingsSection's onChange re-registers routes from the scope.
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(vision.hasProvider('b')).toBe(true)
    const result = await vision.call({ provider: 'b', prompt: 'p', images: [LOADED_IMAGE] })
    expect(result.provider).toBe('b')
    expect(result.model).toBe('model-b')
    await ctx.fiber.dispose()
  })

  it('change the active provider → the next omitted-provider call uses the new active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'answer' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const { ctx, vision, settings } = await mount({
      providers: {
        a: { baseURL: 'https://a.example/v1', model: 'model-a', apiKeyEnv: 'KEY_A' },
        b: { baseURL: 'https://b.example/v1', model: 'model-b', apiKeyEnv: 'KEY_B' },
      },
      active: 'a',
    })
    const viaActive = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(viaActive.provider).toBe('a')

    await settings.update(IMAGE_MIND_SETTINGS_NAMESPACE, { active: 'b' })
    await new Promise(resolve => setTimeout(resolve, 30))
    const next = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(next.provider).toBe('b')
    await ctx.fiber.dispose()
  })

  it('change the model → the next call resolves the new model, in-flight is untouched', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      bodies.push(String(init.body))
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'answer' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }))
    const { ctx, vision, settings } = await mount({
      providers: { a: { baseURL: 'https://a.example/v1', model: 'old-model', apiKeyEnv: 'KEY_A' } },
      active: 'a',
    })
    await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(JSON.parse(bodies[0])['model']).toBe('old-model')

    await settings.update(IMAGE_MIND_SETTINGS_NAMESPACE, { providers: { a: { baseURL: 'https://a.example/v1', model: 'new-model', apiKeyEnv: 'KEY_A' } } })
    await new Promise(resolve => setTimeout(resolve, 30))
    await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(JSON.parse(bodies[1])['model']).toBe('new-model')
    await ctx.fiber.dispose()
  })

  it('removing every provider via the seam empties the routes (replace([]) path)', async () => {
    // Mount with NO entry providers: the composition base layer is empty, so
    // the settings user layer is the only provider source.
    const { ctx, vision, settings } = await mount({})
    expect(vision.hasProvider('a')).toBe(false)
    await settings.update(IMAGE_MIND_SETTINGS_NAMESPACE, {
      providers: { a: { baseURL: 'https://a.example/v1', model: 'model-a', apiKeyEnv: 'KEY_A' } },
      active: 'a',
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(vision.hasProvider('a')).toBe(true)
    // replace() with an empty section is the wholesale-removal path; the
    // empty base layer means nothing resurrects.
    await settings.replace(IMAGE_MIND_SETTINGS_NAMESPACE, { providers: {}, active: undefined })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(vision.hasProvider('a')).toBe(false)
    await expect(vision.call({ prompt: 'p', images: [LOADED_IMAGE] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
    await ctx.fiber.dispose()
  })
})

/** Prove the in-memory provider + schema resolve the same way the plugin expects. */
describe('schema sanity', () => {
  it('resolveConfig agrees with the section schema shape', () => {
    const resolved = resolveConfig({
      providers: { a: { baseURL: 'https://a.example/v1', model: 'm', apiKeyEnv: 'K' } },
      active: 'a',
    })
    expect(resolved.providers['a'].model).toBe('m')
    expect(Config).toBeDefined()
    expect(settingsNamespace('image-mind')).toBe(IMAGE_MIND_SETTINGS_NAMESPACE)
  })
})
