/** @vitest-environment node */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { rememberAttachmentRef } from '../src/attachments/ref-index.ts'
import { understandImageTool } from '../src/tools/understand-image.ts'

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function attachment(idChar: string): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${idChar.repeat(64)}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: PNG.byteLength,
    width: 1,
    height: 1,
  }
}

describe('current-session attachment routing', () => {
  it('lets understand_image omit image/images and resolve the latest session batch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'image-mind-session-route-'))
    roots.push(root)
    const ctx = new Context()
    const called: unknown[] = []
    const refs = [attachment('a'), attachment('b')]

    ctx.provide('attachments', {
      root,
      readImage: vi.fn(async (ref: ImageAttachmentRef) => ({ ref, data: PNG })),
    } as never)
    ctx.provide('vision', {
      call: vi.fn(async (request: unknown) => {
        called.push(request)
        return { text: 'session evidence', provider: 'p', model: 'm' }
      }),
    } as never)

    await rememberAttachmentRef(ctx, refs[0], {
      sessionId: 'session-42', batchId: 'batch', batchIndex: 0, batchCount: 2,
    })
    await rememberAttachmentRef(ctx, refs[1], {
      sessionId: 'session-42', batchId: 'batch', batchIndex: 1, batchCount: 2,
    })

    const tool = understandImageTool(
      ctx,
      () => 'default prompt',
      () => ({ maxBytes: 1024 * 1024, allowPrivateNetwork: false }),
    )
    const result = await tool.execute(
      { prompt: 'compare the attached images' },
      {
        signal: new AbortController().signal,
        agent: { id: 'session-42' },
      } as never,
    )

    expect(result).toMatchObject({
      text: 'session evidence',
      provider: 'p',
      model: 'm',
      images: [
        { source: 'session-image-1', mimeType: 'image/png', bytes: PNG.byteLength },
        { source: 'session-image-2', mimeType: 'image/png', bytes: PNG.byteLength },
      ],
    })
    expect(called).toHaveLength(1)
    const request = called[0] as { prompt: string; images: unknown[] }
    expect(request.prompt).toBe('compare the attached images')
    expect(request.images).toHaveLength(2)
  })

  it('still fails clearly when neither explicit refs nor a current-session batch exists', async () => {
    const ctx = new Context()
    ctx.provide('vision', { call: vi.fn() } as never)
    ctx.provide('attachments', { readImage: vi.fn() } as never)
    const tool = understandImageTool(
      ctx,
      () => 'default prompt',
      () => ({ maxBytes: 1024, allowPrivateNetwork: false }),
    )

    await expect(tool.execute(
      { prompt: 'look at it' },
      { signal: new AbortController().signal, agent: { id: 'missing-session' } } as never,
    )).rejects.toThrow(/image reference|uploaded image|session/i)
  })
})
