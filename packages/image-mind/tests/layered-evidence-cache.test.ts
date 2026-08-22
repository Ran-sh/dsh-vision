/** @vitest-environment node */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMemoryVisionCache } from '@ran-sh/dsh-vision'
import { understandImageTool } from '../src/tools/understand-image.ts'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

function imageFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-evidence-cache-'))
  const file = join(dir, 'img.png')
  writeFileSync(file, PNG)
  return file
}

function setup() {
  const call = vi.fn(async (_request: unknown) => ({ text: `facts-${call.mock.calls.length}`, provider: 'p', model: 'm' }))
  const ctx = new Context()
  ctx.provide('vision', { call } as never)
  ctx.provide('attachments', {} as never)
  const cache = createMemoryVisionCache({ ttlMs: 60_000, maxEntries: 8 })
  const tool = understandImageTool(
    ctx,
    () => 'describe image',
    () => ({ maxBytes: 1024 * 1024, allowPrivateNetwork: false }),
    cache,
  )
  return { call, tool }
}

describe('layered reusable evidence cache', () => {
  it('reuses same-image same-task evidence across different OCR questions', async () => {
    const { call, tool } = setup()
    const file = imageFile()
    const exec = { signal: new AbortController().signal } as never

    const first = await tool.execute({ image: file, prompt: 'transcribe all text verbatim' }, exec)
    const second = await tool.execute({ image: file, prompt: '提取文字并告诉我标题' }, exec)

    expect(call).toHaveBeenCalledTimes(1)
    const firstRequest = call.mock.calls[0][0] as { prompt: string }
    expect(firstRequest.prompt).toContain('OCR evidence extraction')
    expect(first.text).toBe(second.text)
    expect(second.trace).toMatchObject({ providerCalls: 0, cacheHits: 1 })
  })

  it('refresh bypasses reusable evidence and replaces it', async () => {
    const { call, tool } = setup()
    const file = imageFile()
    const exec = { signal: new AbortController().signal } as never

    const first = await tool.execute({ image: file, prompt: 'OCR all visible text' }, exec)
    const refreshed = await tool.execute({ image: file, prompt: 'OCR all visible text', cache: 'refresh' }, exec)
    const reused = await tool.execute({ image: file, prompt: 'read all text' }, exec)

    expect(call).toHaveBeenCalledTimes(2)
    expect(refreshed.text).not.toBe(first.text)
    expect(reused.text).toBe(refreshed.text)
    expect(reused.trace).toMatchObject({ providerCalls: 0, cacheHits: 1 })
  })

  it('no-store refocus uses the precise caller prompt without replacing broad reusable evidence', async () => {
    const { call, tool } = setup()
    const file = imageFile()
    const exec = { signal: new AbortController().signal } as never

    const broad = await tool.execute({ image: file, prompt: 'OCR all visible text' }, exec)
    const cached = await tool.execute({ image: file, prompt: 'OCR the exact tiny value in row 3 column 2' }, exec)
    const refocused = await tool.execute({
      image: file,
      prompt: 'OCR row 3, column 2 only and report the exact visible value; mark it unclear rather than guessing.',
      cache: 'no-store',
    }, exec)
    const reused = await tool.execute({ image: file, prompt: 'read all text again' }, exec)

    expect(cached.route).toMatchObject({ source: 'evidence-cache' })
    expect(call).toHaveBeenCalledTimes(2)
    expect(call.mock.calls[1][0]).toMatchObject({
      prompt: 'OCR row 3, column 2 only and report the exact visible value; mark it unclear rather than guessing.',
      cache: 'no-store',
    })
    expect(refocused.text).not.toBe(broad.text)
    expect(reused.text).toBe(broad.text)
    expect(reused.route).toMatchObject({ source: 'evidence-cache' })
  })

  it('does not layer-cache ordinary photo questions', async () => {
    const { call, tool } = setup()
    const file = imageFile()
    const exec = { signal: new AbortController().signal } as never

    await tool.execute({ image: file, prompt: 'describe this photo' }, exec)
    await tool.execute({ image: file, prompt: 'what is the person holding in this photo?' }, exec)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('explicit provider bypasses layered reuse and keeps the caller prompt', async () => {
    const { call, tool } = setup()
    const file = imageFile()
    const exec = { signal: new AbortController().signal } as never

    await tool.execute({ image: file, prompt: 'transcribe all text verbatim', provider: 'chosen' }, exec)
    await tool.execute({ image: file, prompt: 'transcribe all text verbatim', provider: 'chosen' }, exec)

    expect(call).toHaveBeenCalledTimes(2)
    expect(call.mock.calls[0][0]).toMatchObject({ provider: 'chosen', prompt: 'transcribe all text verbatim' })
  })

  it('explicit model bypasses layered reuse and preserves model stickiness', async () => {
    const { call, tool } = setup()
    const file = imageFile()
    const exec = { signal: new AbortController().signal } as never

    const first = await tool.execute({ image: file, prompt: 'transcribe all text verbatim', model: 'chosen-model' }, exec)
    const second = await tool.execute({ image: file, prompt: 'transcribe all text verbatim', model: 'chosen-model' }, exec)

    expect(call).toHaveBeenCalledTimes(2)
    expect(call.mock.calls[0][0]).toMatchObject({ model: 'chosen-model', prompt: 'transcribe all text verbatim' })
    expect(call.mock.calls[1][0]).toMatchObject({ model: 'chosen-model', prompt: 'transcribe all text verbatim' })
    expect(first.route).toMatchObject({ requestedModel: 'chosen-model', evidenceLayerEnabled: false, source: 'provider' })
    expect(second.route).toMatchObject({ requestedModel: 'chosen-model', evidenceLayerEnabled: false, source: 'provider' })
  })
})
