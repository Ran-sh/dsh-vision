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

describe('understand_image diagnostics passthrough', () => {
  it('keeps execution trace and provider token usage in the structured tool result', async () => {
    const ctx = new Context()
    const trace = {
      providerCalls: 3,
      payloadBytes: 12345,
      cacheHits: 0,
      retries: 1,
      modelFallbacks: 0,
      providerFallbacks: 1,
      splits: 0,
    }
    const usage = { inputTokens: 4321, outputTokens: 210 }
    ctx.provide('vision', {
      call: vi.fn(async () => ({ text: 'answer', provider: 'backup', model: 'vision', trace, usage })),
    } as never)
    ctx.provide('attachments', {} as never)

    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-trace-'))
    const file = join(dir, 'img.png')
    writeFileSync(file, PNG)

    const tool = understandImageTool(ctx, () => 'describe', () => ({ maxBytes: 1024 * 1024, allowPrivateNetwork: false }))
    const result = await tool.execute({ image: file }, { signal: new AbortController().signal } as never)

    expect(result.trace).toEqual(trace)
    expect(result.usage).toEqual(usage)
    expect(result.provider).toBe('backup')
    expect(result.text).toBe('answer')
  })
})
