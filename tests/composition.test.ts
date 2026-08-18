/**
 * Cross-package composition integration tests: the @ran-sh/dsh-vision service
 * package (owns ctx.vision) and the dsh-plugin-image-mind provider package
 * (injects ['vision']) loaded through the real Cordis Loader from a
 * cordis.yml, exactly as a DSH web profile would. Proves:
 *   A. image-mind WITHOUT the vision service is not activatable (inject
 *      dependency never resolves — it must not create its own runtime);
 *   B. vision service first, then image-mind → both activate;
 *   C. ctx.vision.call(...) reaches the adapter image-mind registered;
 *   D. unloading image-mind removes its routes but ctx.vision survives;
 *   E. reloading image-mind restores its routes.
 * This is the core evidence that Service lifecycle ≠ Provider lifecycle.
 * @vitest-environment node
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Vision from '@ran-sh/dsh-vision'
import * as ImageMind from '../packages/image-mind/src/index.ts'

/** A chat-completions success response the mocked fetch returns. */
function okChatResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: 'vision answer' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** A tiny valid PNG. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])
const LOADED_IMAGE = { bytes: PNG_BYTES, mimeType: 'image/png' as const }

/** A test-only plugin that provides the 'tools' service image-mind injects. */
const TestToolsPlugin = {
  name: 'test-tools',
  provide: 'tools',
  apply(ctx: Context): void {
    let registered: Array<{ execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown> }> = []
    ctx.provide('tools', {
      register: (definition: { execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown> }) => {
        registered.push(definition)
        return () => {
          registered = registered.filter(entry => entry !== definition)
        }
      },
    } as never)
    ;(ctx as unknown as Record<string, unknown>)['__testTools'] = {
      count: () => registered.length,
      execute: async (index: number, args: Record<string, unknown>) => {
        const tool = registered[index]
        if (tool === undefined) throw new Error(`no tool at index ${index}`)
        return tool.execute(args, { signal: new AbortController().signal })
      },
    }
  },
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  try {
    await context?.fiber.dispose()
  } catch {
    // Cordis teardown may touch vitest matchers while logging a late error;
    // the per-test assertions already ran — teardown noise must not fail the
    // suite.
  }
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot a Loader over a cordis.yml with the given rows. */
async function loadComposition(
  rows: string[],
): Promise<{ ctx: Context; wait: (ms?: number) => Promise<void> }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-vision-composition-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, rows.join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@ran-sh/dsh-vision', Vision],
    ['dsh-plugin-image-mind', ImageMind],
    ['test-tools', TestToolsPlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, wait: () => new Promise(resolve => setTimeout(resolve, 50)) }
}

/** The two composition rows (vision service + image-mind provider) plus tools. */
function fullCompositionRows(config: Record<string, unknown>): string[] {
  const providers = (config.providers ?? {}) as Record<string, { baseURL: string; model: string; apiKeyEnv: string }>
  const lines = [
    '- id: test-tools',
    "  name: 'test-tools'",
    '- id: vision-runtime',
    "  name: '@ran-sh/dsh-vision'",
    '- id: image-mind',
    "  name: 'dsh-plugin-image-mind'",
    '  config:',
    `    active: ${JSON.stringify(config.active)}`,
    '    providers:',
  ]
  for (const [id, provider] of Object.entries(providers)) {
    lines.push(
      `      ${id}:`,
      `        baseURL: ${JSON.stringify(provider.baseURL)}`,
      `        model: ${JSON.stringify(provider.model)}`,
      `        apiKeyEnv: ${JSON.stringify(provider.apiKeyEnv)}`,
    )
  }
  return lines
}

describe('cross-package composition (service vs provider lifecycle)', () => {
  it('A: image-mind WITHOUT the vision service is not activatable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { ctx } = await loadComposition([
      '- id: test-tools',
      "  name: 'test-tools'",
      '- id: image-mind',
      "  name: 'dsh-plugin-image-mind'",
      '  config:',
      '    active: a',
      '    providers:',
      '      a:',
      '        baseURL: https://a.example/v1',
      '        model: m',
      '        apiKeyEnv: KEY_A',
    ])
    // The image-mind entry is waiting on the 'vision' service, which nothing
    // provides: its apply must NOT have run, and no ctx.vision exists.
    expect(ctx.get('vision')).toBeUndefined()
    // It must not have created its own runtime: the tool registry saw no
    // registration from image-mind either (apply never ran).
    const tools = (ctx as unknown as { __testTools?: { count: () => number } }).__testTools
    expect(tools?.count() ?? 0).toBe(0)
    // A tiny settle window: even if image-mind's apply somehow ran, it would
    // have needed ctx.vision — which is absent — so nothing can be live.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(ctx.get('vision')).toBeUndefined()
    expect(tools?.count() ?? 0).toBe(0)
  })

  it('B+C: vision service + image-mind → ctx.vision.call reaches the registered adapter', async () => {
    vi.stubEnv('KEY_A', 'sk-a')
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { ctx } = await loadComposition(fullCompositionRows({
      active: 'a',
      providers: { a: { baseURL: 'https://a.example/v1', model: 'm', apiKeyEnv: 'KEY_A' } },
    }))
    const vision = ctx.get('vision') as Vision.VisionRuntime
    expect(vision).toBeDefined()
    // image-mind registered the route into the INJECTED service.
    expect(vision.hasProvider('a')).toBe(true)
    const result = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(result.provider).toBe('a')
    expect(result.model).toBe('m')
    expect(result.text).toBe('vision answer')
  })

  it('D: unloading image-mind removes its routes but ctx.vision survives', async () => {
    vi.stubEnv('KEY_A', 'sk-a')
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    // Load ONLY the service + tools (no image-mind row): the provider is
    // managed at fiber level below, which is exactly what a profile reload
    // does to a provider entry.
    const { ctx } = await loadComposition([
      '- id: test-tools',
      "  name: 'test-tools'",
      '- id: vision-runtime',
      "  name: '@ran-sh/dsh-vision'",
    ])
    const vision = ctx.get('vision') as Vision.VisionRuntime
    const provider = await ctx.plugin(ImageMind, {
      active: 'a',
      providers: { a: { baseURL: 'https://a.example/v1', model: 'm', apiKeyEnv: 'KEY_A' } },
    })
    expect(vision.hasProvider('a')).toBe(true)

    // Dispose the provider fiber: its routes disappear...
    await provider.dispose().catch(() => undefined)
    expect(vision.hasProvider('a')).toBe(false)
    // ...but the SERVICE survives: ctx.vision is still resolvable and still
    // answers with a clear provider error (never "service missing").
    expect(ctx.get('vision')).toBeDefined()
    const failure = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] }).then(
      () => undefined,
      (error: { code?: string }) => error,
    )
    expect(failure?.code).toBe('PROVIDER_NOT_FOUND')
  })

  it('E: reloading image-mind restores its routes', async () => {
    vi.stubEnv('KEY_A', 'sk-a')
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { ctx } = await loadComposition([
      '- id: test-tools',
      "  name: 'test-tools'",
      '- id: vision-runtime',
      "  name: '@ran-sh/dsh-vision'",
    ])
    const vision = ctx.get('vision') as Vision.VisionRuntime
    expect(vision.hasProvider('a')).toBe(false)

    // Load the provider, dispose it, load again: routes follow the fiber.
    const first = await ctx.plugin(ImageMind, {
      active: 'a',
      providers: { a: { baseURL: 'https://a.example/v1', model: 'm', apiKeyEnv: 'KEY_A' } },
    })
    expect(vision.hasProvider('a')).toBe(true)
    await first.dispose()
    expect(vision.hasProvider('a')).toBe(false)

    const second = await ctx.plugin(ImageMind, {
      active: 'a',
      providers: { a: { baseURL: 'https://a.example/v1', model: 'm', apiKeyEnv: 'KEY_A' } },
    })
    expect(vision.hasProvider('a')).toBe(true)
    const result = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(result.provider).toBe('a')
    await second.dispose()
  })

  it('F: unloading image-mind withdraws the default-provider strategy (no stale resolver)', async () => {
    vi.stubEnv('KEY_A', 'sk-a')
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { ctx } = await loadComposition([
      '- id: test-tools',
      "  name: 'test-tools'",
      '- id: vision-runtime',
      "  name: '@ran-sh/dsh-vision'",
    ])
    const vision = ctx.get('vision') as Vision.VisionRuntime
    const provider = await ctx.plugin(ImageMind, {
      active: 'a',
      providers: { a: { baseURL: 'https://a.example/v1', model: 'm', apiKeyEnv: 'KEY_A' } },
    })
    expect(vision.hasProvider('a')).toBe(true)
    // The strategy is live: an omitted-provider call routes to the active.
    const viaActive = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] })
    expect(viaActive.provider).toBe('a')

    // Unload the provider: routes AND the default-provider strategy go away
    // together — the runtime must not still be holding image-mind's closure.
    await provider.dispose().catch(() => undefined)
    const failure = await vision.call({ prompt: 'p', images: [LOADED_IMAGE] }).then(
      () => undefined,
      (error: { code?: string }) => error,
    )
    expect(failure?.code).toBe('PROVIDER_NOT_FOUND')
  })

  it('G: multi-provider routes dispatch through one adapter; a second provider plugin could own other routes', async () => {
    vi.stubEnv('KEY_A', 'sk-a')
    vi.stubEnv('KEY_B', 'sk-b')
    vi.stubGlobal('fetch', vi.fn(async () => okChatResponse()))
    const { ctx } = await loadComposition(fullCompositionRows({
      active: 'a',
      providers: {
        a: { baseURL: 'https://a.example/v1', model: 'm', apiKeyEnv: 'KEY_A' },
        b: { baseURL: 'https://b.example/v1', model: 'm2', apiKeyEnv: 'KEY_B' },
      },
    }))
    const vision = ctx.get('vision') as Vision.VisionRuntime
    // Both routes are live and served by the adapter image-mind registered.
    expect(vision.hasProvider('a')).toBe(true)
    expect(vision.hasProvider('b')).toBe(true)
    const viaB = await vision.call({ provider: 'b', prompt: 'p', images: [LOADED_IMAGE] })
    expect(viaB.provider).toBe('b')
    expect(viaB.model).toBe('m2')
  })
})
