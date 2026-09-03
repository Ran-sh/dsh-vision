/** @vitest-environment node */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MAX_SESSION_BATCH_OFFSET } from '../src/attachments/session-history.ts'
import { understandImageTool } from '../src/tools/understand-image.ts'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

// Behavioral tests enable the local-file policy confined to a fixture root.
let allowedRoots: string[] = []

function tool() {
  const ctx = new Context()
  ctx.provide('vision', {
    call: async () => ({ text: 'ok', provider: 'p', model: 'm' }),
  } as never)
  ctx.provide('attachments', {} as never)
  return understandImageTool(ctx, () => 'describe', () => ({
    maxBytes: 1024 * 1024,
    allowPrivateNetwork: false,
    allowLocalFiles: true,
    localFileRoots: allowedRoots,
  }))
}

describe('understand_image session history selector', () => {
  it('rejects a batch offset when explicit image references are supplied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'image-mind-history-tool-'))
    const file = join(dir, 'image.png')
    writeFileSync(file, PNG)
    allowedRoots = [dir]

    await expect(tool().execute(
      { image: file, sessionBatchOffset: 1, prompt: 'describe' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/only valid when `image` and `images` are omitted/)
  })

  it('rejects invalid batch offsets before attempting session resolution', async () => {
    await expect(tool().execute(
      { sessionBatchOffset: -1, prompt: 'describe' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/sessionBatchOffset must be an integer/)

    await expect(tool().execute(
      { sessionBatchOffset: MAX_SESSION_BATCH_OFFSET + 1, prompt: 'describe' },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/sessionBatchOffset must be an integer/)
  })

  it('fails with an actionable error when the requested historical batch does not exist', async () => {
    await expect(tool().execute(
      { sessionBatchOffset: 1, prompt: 'describe' },
      { signal: new AbortController().signal, agent: { id: 'missing-session' } } as never,
    )).rejects.toThrow(/no complete session image batch exists at offset 1/)
  })
})
