/**
 * Structural + behavioral tests for the thin tool: `understand_image` must
 * not import provider-internal types or construct a `VisionConnection`, and
 * its execute path must call `ctx.vision.call` with a single argument (the
 * request only — provider selection and the connection snapshot belong to the
 * runtime).
 * @vitest-environment node
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { understandImageTool } from '../src/tools/understand-image.ts'

describe('understand_image thinness (structural)', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../src/tools/understand-image.ts'), 'utf8')

  it('does not import ResolvedProvider or ResolvedConfig internals', () => {
    expect(source).not.toMatch(/import[^;]*ResolvedProvider/)
    expect(source).not.toMatch(/from '\.\.\/config\.ts'/)
    expect(source).not.toMatch(/providerFor|connectionFor/)
  })

  it('does not reference connection internals (baseURL/apiKeyEnv/apiStyle/maxOutputTokens/timeoutMs)', () => {
    // The description strings may mention a baseURL placeholder; what matters
    // is that no CONNECTION TYPE or constructor is imported or used. Check the
    // executable surface: no VisionConnection type, no connection builder.
    expect(source).not.toMatch(/VisionConnection/)
    expect(source).not.toMatch(/connectionFor|resolveDraftConnection|draftConnectionOf/)
    // The tool must not read these fields off any object it builds.
    expect(source).not.toMatch(/\.apiKeyEnv|\.apiStyle|\.maxOutputTokens|\.timeoutMs/)
  })

  it('calls ctx.vision.call with a single argument', () => {
    expect(source).toMatch(/ctx\.vision\.call\(\{/)
  })
})

describe('understand_image execute (behavioral)', () => {
  it('passes only the request to ctx.vision.call and returns the result', async () => {
    const ctx = new Context()
    const called: unknown[] = []
    ctx.provide('vision', {
      call: vi.fn(async (request: unknown) => {
        called.push(request)
        return { text: 'the answer', provider: 'a', model: 'm1' }
      }),
    } as never)
    // The tool only needs the vision service; use a tiny real image.
    const image = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ])
    ctx.provide('attachments', {} as never)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-test-'))
    const file = join(dir, 'img.png')
    writeFileSync(file, image)

    const tool = understandImageTool(ctx, () => 'default prompt', () => ({ maxBytes: 10 * 1024 * 1024, allowPrivateNetwork: false }))
    const result = await tool.execute({ image: file, prompt: 'describe' }, { signal: new AbortController().signal } as never)
    expect(result).toEqual({
      text: 'the answer',
      model: 'm1',
      provider: 'a',
      // The result carries a SAFE identity (basename), never the full path.
      images: [{ source: 'img.png', mimeType: 'image/png', bytes: image.length }],
    })
    expect(JSON.stringify(result)).not.toContain(dir)
    expect(called).toHaveLength(1)
    const request = called[0] as { provider?: string; model?: string; prompt: string; images: unknown[]; signal: unknown }
    expect(request.provider).toBeUndefined()
    expect(request.model).toBeUndefined()
    expect(request.prompt).toBe('describe')
    expect(Array.isArray(request.images)).toBe(true)
    expect(request.images).toHaveLength(1)
  })

  it('passes several images via the `images` array (multi-image flow)', async () => {
    const ctx = new Context()
    const called: unknown[] = []
    ctx.provide('vision', {
      call: vi.fn(async (request: unknown) => {
        called.push(request)
        return { text: 'the answer', provider: 'a', model: 'm1' }
      }),
    } as never)
    ctx.provide('attachments', {} as never)
    const imageA = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ])
    const imageB = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ])
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-test-'))
    const fileA = join(dir, 'a.png')
    const fileB = join(dir, 'b.png')
    writeFileSync(fileA, imageA)
    writeFileSync(fileB, imageB)

    const tool = understandImageTool(ctx, () => 'compare them', () => ({ maxBytes: 10 * 1024 * 1024, allowPrivateNetwork: false }))
    const result = await tool.execute({ images: [fileA, fileB] }, { signal: new AbortController().signal } as never)
    expect(result).toEqual({
      text: 'the answer',
      model: 'm1',
      provider: 'a',
      images: [
        { source: 'a.png', mimeType: 'image/png', bytes: imageA.length },
        { source: 'b.png', mimeType: 'image/png', bytes: imageB.length },
      ],
    })
    expect(JSON.stringify(result)).not.toContain(dir)
    const request = called[0] as { images: unknown[]; prompt: string }
    expect(request.images).toHaveLength(2)
    expect(request.prompt).toBe('compare them')
  })

  it('rejects more than MAX_IMAGES_PER_REQUEST images', async () => {
    const ctx = new Context()
    ctx.provide('vision', { call: vi.fn(async () => ({ text: 'x', provider: 'a', model: 'm' })) } as never)
    ctx.provide('attachments', {} as never)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-test-'))
    const files = []
    for (let i = 0; i < 6; i++) {
      const file = join(dir, `img-${i}.png`)
      writeFileSync(file, Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      ]))
      files.push(file)
    }
    const tool = understandImageTool(ctx, () => 'p', () => ({ maxBytes: 10 * 1024 * 1024, allowPrivateNetwork: false }))
    await expect(tool.execute({ images: files }, { signal: new AbortController().signal } as never)).rejects.toThrow(/at most 4 images/)
  })

  it('rejects an empty image reference set', async () => {
    const ctx = new Context()
    ctx.provide('vision', { call: vi.fn(async () => ({ text: 'x', provider: 'a', model: 'm' })) } as never)
    ctx.provide('attachments', {} as never)
    const tool = understandImageTool(ctx, () => 'p', () => ({ maxBytes: 10 * 1024 * 1024, allowPrivateNetwork: false }))
    await expect(tool.execute({}, { signal: new AbortController().signal } as never)).rejects.toThrow(/at least one image/)
  })

  it('rejects `image` and `images` together (mutual exclusion)', async () => {
    const ctx = new Context()
    ctx.provide('vision', { call: vi.fn(async () => ({ text: 'x', provider: 'a', model: 'm' })) } as never)
    ctx.provide('attachments', {} as never)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-test-'))
    const file = join(dir, 'img.png')
    writeFileSync(file, Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]))
    const tool = understandImageTool(ctx, () => 'p', () => ({ maxBytes: 10 * 1024 * 1024, allowPrivateNetwork: false }))
    await expect(tool.execute({ image: file, images: [file] }, { signal: new AbortController().signal } as never))
      .rejects.toThrow(/not both/)
  })

  it('rejects empty strings inside the images array', async () => {
    const ctx = new Context()
    ctx.provide('vision', { call: vi.fn(async () => ({ text: 'x', provider: 'a', model: 'm' })) } as never)
    ctx.provide('attachments', {} as never)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-test-'))
    const file = join(dir, 'img.png')
    writeFileSync(file, Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]))
    const tool = understandImageTool(ctx, () => 'p', () => ({ maxBytes: 10 * 1024 * 1024, allowPrivateNetwork: false }))
    await expect(tool.execute({ images: [file, ''] }, { signal: new AbortController().signal } as never))
      .rejects.toThrow(/non-empty/)
  })

  it('rejects a combined size above the total byte bound', async () => {
    const ctx = new Context()
    ctx.provide('vision', { call: vi.fn(async () => ({ text: 'x', provider: 'a', model: 'm' })) } as never)
    ctx.provide('attachments', {} as never)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-test-'))
    // Four files, each under the per-image cap (60 < 100) but summing past
    // the total bound (totalCap = 100 * 2 = 200; 4 * 60 = 240 > 200).
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(52)])
    const files = []
    for (let i = 0; i < 4; i++) {
      const file = join(dir, `t-${i}.png`)
      writeFileSync(file, png)
      files.push(file)
    }
    const tool = understandImageTool(ctx, () => 'p', () => ({ maxBytes: 100, allowPrivateNetwork: false }))
    await expect(tool.execute({ images: files }, { signal: new AbortController().signal } as never))
      .rejects.toThrow(/combined image size/)
  })

  it('URL sources are reported as host only (no query secrets)', async () => {
    const ctx = new Context()
    ctx.provide('vision', { call: vi.fn(async () => ({ text: 'x', provider: 'a', model: 'm' })) } as never)
    ctx.provide('attachments', {} as never)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]), { status: 200 })))
    const tool = understandImageTool(ctx, () => 'p', () => ({ maxBytes: 10 * 1024 * 1024, allowPrivateNetwork: false }))
    const result = await tool.execute(
      { image: 'https://example.com/secret?token=abc123' },
      { signal: new AbortController().signal } as never,
    )
    const resultJson = JSON.stringify(result)
    expect(resultJson).not.toContain('token=abc123')
    expect(resultJson).toContain('example.com')
    vi.unstubAllGlobals()
  })
})
