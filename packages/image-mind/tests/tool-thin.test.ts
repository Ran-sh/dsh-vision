/**
 * Structural + behavioral tests for the thin tool: `understand_image` must
 * not import provider-internal connection facts, and its execute path must
 * hand one provider-neutral request to `ctx.vision.call`.
 * @vitest-environment node
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MAX_IMAGES_PER_REQUEST, understandImageTool } from '../src/tools/understand-image.ts'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

function imageFiles(count: number): { dir: string; files: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-test-'))
  const files = Array.from({ length: count }, (_, index) => {
    const file = join(dir, `img-${index}.png`)
    writeFileSync(file, PNG)
    return file
  })
  return { dir, files }
}

function contextWithVision(called: unknown[] = []): Context {
  const ctx = new Context()
  ctx.provide('vision', {
    call: vi.fn(async (request: unknown) => {
      called.push(request)
      return { text: 'the answer', provider: 'a', model: 'm1' }
    }),
  } as never)
  ctx.provide('attachments', {} as never)
  return ctx
}

function toolFor(ctx: Context, maxBytes = 10 * 1024 * 1024) {
  return understandImageTool(ctx, () => 'default prompt', () => ({ maxBytes, allowPrivateNetwork: false }))
}

describe('understand_image thinness (structural)', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../src/tools/understand-image.ts'), 'utf8')

  it('does not import provider configuration internals', () => {
    expect(source).not.toMatch(/import[^;]*ResolvedProvider/)
    expect(source).not.toMatch(/from '\.\.\/config\.ts'/)
    expect(source).not.toMatch(/providerFor|connectionFor/)
  })

  it('does not reference connection internals', () => {
    expect(source).not.toMatch(/VisionConnection/)
    expect(source).not.toMatch(/connectionFor|resolveDraftConnection|draftConnectionOf/)
    expect(source).not.toMatch(/\.apiKeyEnv|\.apiStyle|\.maxOutputTokens|\.timeoutMs/)
  })

  it('calls ctx.vision.call with a single request object', () => {
    expect(source).toMatch(/ctx\.vision\.call\(\{/)
  })
})

describe('understand_image execute (behavioral)', () => {
  it('passes only the request to ctx.vision.call and returns a safe result identity', async () => {
    const called: unknown[] = []
    const ctx = contextWithVision(called)
    const { dir, files } = imageFiles(1)

    const result = await toolFor(ctx).execute(
      { image: files[0], prompt: 'describe' },
      { signal: new AbortController().signal } as never,
    )

    expect(result).toEqual({
      text: 'the answer',
      model: 'm1',
      provider: 'a',
      route: {
        source: 'provider',
        selectedProvider: 'a',
        selectedModel: 'm1',
        modelFallback: false,
        providerFallback: false,
      },
      images: [{ source: 'img-0.png', mimeType: 'image/png', bytes: PNG.length }],
    })
    expect(JSON.stringify(result)).not.toContain(dir)
    expect(called).toHaveLength(1)
    const request = called[0] as { provider?: string; model?: string; prompt: string; images: unknown[] }
    expect(request.provider).toBeUndefined()
    expect(request.model).toBeUndefined()
    expect(request.prompt).toBe('describe')
    expect(request.images).toHaveLength(1)
  })

  it('passes several images via the images array', async () => {
    const called: unknown[] = []
    const ctx = contextWithVision(called)
    const { dir, files } = imageFiles(2)

    const result = await toolFor(ctx).execute(
      { images: files, prompt: 'compare them' },
      { signal: new AbortController().signal } as never,
    )

    expect(result.images).toEqual([
      { source: 'img-0.png', mimeType: 'image/png', bytes: PNG.length },
      { source: 'img-1.png', mimeType: 'image/png', bytes: PNG.length },
    ])
    expect(JSON.stringify(result)).not.toContain(dir)
    const request = called[0] as { images: unknown[]; prompt: string }
    expect(request.images).toHaveLength(2)
    expect(request.prompt).toBe('compare them')
  })

  it('accepts exactly MAX_IMAGES_PER_REQUEST small images', async () => {
    const called: unknown[] = []
    const ctx = contextWithVision(called)
    const { files } = imageFiles(MAX_IMAGES_PER_REQUEST)

    await expect(toolFor(ctx).execute(
      { images: files, prompt: 'compare all' },
      { signal: new AbortController().signal } as never,
    )).resolves.toMatchObject({ text: 'the answer' })

    expect(MAX_IMAGES_PER_REQUEST).toBe(8)
    expect((called[0] as { images: unknown[] }).images).toHaveLength(8)
  })

  it('rejects more than MAX_IMAGES_PER_REQUEST images', async () => {
    const ctx = contextWithVision()
    const { files } = imageFiles(MAX_IMAGES_PER_REQUEST + 1)

    await expect(toolFor(ctx).execute(
      { images: files },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/at most 8 images/)
  })

  it('passes explicit cache refresh through the provider-neutral request', async () => {
    const called: unknown[] = []
    const ctx = contextWithVision(called)
    const { files } = imageFiles(1)

    await toolFor(ctx).execute(
      { image: files[0], prompt: 'read again', cache: 'refresh' },
      { signal: new AbortController().signal } as never,
    )

    expect(called[0]).toMatchObject({ cache: 'refresh', prompt: 'read again' })
  })

  it('rejects an empty image reference set', async () => {
    const ctx = contextWithVision()
    await expect(toolFor(ctx).execute(
      {},
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/at least one image/)
  })

  it('rejects image and images together', async () => {
    const ctx = contextWithVision()
    const { files } = imageFiles(1)
    await expect(toolFor(ctx).execute(
      { image: files[0], images: [files[0]] },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/not both/)
  })

  it('rejects empty strings inside the images array', async () => {
    const ctx = contextWithVision()
    const { files } = imageFiles(1)
    await expect(toolFor(ctx).execute(
      { images: [files[0], ''] },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/non-empty/)
  })

  it('rejects a combined size above the total byte bound', async () => {
    const ctx = contextWithVision()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-test-'))
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(52),
    ])
    const files = Array.from({ length: 4 }, (_, index) => {
      const file = join(dir, `t-${index}.png`)
      writeFileSync(file, png)
      return file
    })

    await expect(toolFor(ctx, 100).execute(
      { images: files },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/combined image size/)
  })

  it('reports URL sources as host only, without query secrets', async () => {
    const ctx = contextWithVision()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG, { status: 200 })))
    try {
      const result = await toolFor(ctx).execute(
        { image: 'https://example.com/secret?token=abc123' },
        { signal: new AbortController().signal } as never,
      )
      const resultJson = JSON.stringify(result)
      expect(resultJson).not.toContain('token=abc123')
      expect(resultJson).toContain('example.com')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports an expired bare sha256 attachment id clearly', async () => {
    const ctx = contextWithVision()
    await expect(toolFor(ctx).execute(
      { image: 'sha256:abc123' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/no longer available|re-send/)
  })
})
