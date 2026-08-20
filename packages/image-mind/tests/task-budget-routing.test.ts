/** @vitest-environment node */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { understandImageTool } from '../src/tools/understand-image.ts'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

function imageFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-budget-'))
  const file = join(dir, 'img.png')
  writeFileSync(file, PNG)
  return file
}

function toolWithCall(call: ReturnType<typeof vi.fn>) {
  const ctx = new Context()
  ctx.provide('vision', { call } as never)
  ctx.provide('attachments', {} as never)
  return understandImageTool(ctx, () => 'describe the image', () => ({ maxBytes: 1024 * 1024, allowPrivateNetwork: false }))
}

describe('understand_image task-aware budgets', () => {
  it('requests an OCR-sized output budget for transcription', async () => {
    const call = vi.fn(async () => ({ text: 'ok', provider: 'p', model: 'm' }))
    const tool = toolWithCall(call)
    await tool.execute({ image: imageFile(), prompt: 'transcribe all text verbatim' }, { signal: new AbortController().signal } as never)

    expect(call).toHaveBeenCalledOnce()
    expect(call.mock.calls[0][0]).toMatchObject({
      prompt: 'transcribe all text verbatim',
      maxOutputTokens: 3000,
    })
  })

  it('requests a smaller output budget for ordinary photo description', async () => {
    const call = vi.fn(async () => ({ text: 'ok', provider: 'p', model: 'm' }))
    const tool = toolWithCall(call)
    await tool.execute({ image: imageFile(), prompt: 'describe this photo' }, { signal: new AbortController().signal } as never)

    expect(call.mock.calls[0][0]).toMatchObject({ maxOutputTokens: 1000 })
  })
})
