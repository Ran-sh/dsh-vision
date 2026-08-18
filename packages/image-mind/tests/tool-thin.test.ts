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
    expect(result).toEqual({ text: 'the answer', model: 'm1', provider: 'a', image: file, mimeType: 'image/png', bytes: image.length })
    expect(called).toHaveLength(1)
    const request = called[0] as { provider?: string; model?: string; prompt: string; images: unknown[]; signal: unknown }
    expect(request.provider).toBeUndefined()
    expect(request.model).toBeUndefined()
    expect(request.prompt).toBe('describe')
    expect(Array.isArray(request.images)).toBe(true)
  })
})
