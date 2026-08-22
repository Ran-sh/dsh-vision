/** @vitest-environment node */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  commitSessionAttachmentBatch,
  discardSessionAttachmentBatch,
  durableAttachmentRefById,
  latestSessionAttachmentRefs,
  rememberAttachmentRef,
  sessionAttachmentPreviewBatches,
} from '../src/attachments/ref-index.ts'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'image-mind-discard-'))
  roots.push(value)
  return value
}

function ctxFor(attachmentRoot: string): Context {
  return {
    get(key: string) {
      return key === 'attachments' ? { root: attachmentRoot } : undefined
    },
  } as unknown as Context
}

function ref(char: string): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${char.repeat(64)}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 4,
    width: 1,
    height: 1,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('failed session image routing discard', () => {
  it('restores the previous committed batch without deleting attachment metadata', async () => {
    const ctx = ctxFor(await root())
    const committed = ref('a')
    const failed = ref('b')

    await rememberAttachmentRef(ctx, committed, {
      sessionId: 'session-restore', batchId: 'batch-a', batchIndex: 0, batchCount: 1,
    })
    await expect(commitSessionAttachmentBatch(ctx, 'session-restore', 'batch-a')).resolves.toBe(true)

    await rememberAttachmentRef(ctx, failed, {
      sessionId: 'session-restore', batchId: 'batch-b', batchIndex: 0, batchCount: 1,
    })
    await expect(latestSessionAttachmentRefs(ctx, 'session-restore')).resolves.toEqual([failed])

    await expect(discardSessionAttachmentBatch(ctx, 'session-restore', 'batch-b')).resolves.toBe(true)
    await expect(latestSessionAttachmentRefs(ctx, 'session-restore')).resolves.toEqual([committed])
    await expect(sessionAttachmentPreviewBatches(ctx, 'session-restore')).resolves.toEqual([
      expect.objectContaining({ batchId: 'batch-a', count: 1 }),
    ])

    // Discard only removes image-mind routing state. DSH-owned attachment bytes
    // are never deleted; the validated metadata remains readable by id.
    await expect(durableAttachmentRefById(ctx, String(failed.attachmentId))).resolves.toEqual(failed)
  })

  it('removes a transient session record when there is no committed history', async () => {
    const ctx = ctxFor(await root())
    const failed = ref('c')

    await rememberAttachmentRef(ctx, failed, {
      sessionId: 'session-empty', batchId: 'batch-only', batchIndex: 0, batchCount: 1,
    })
    await expect(discardSessionAttachmentBatch(ctx, 'session-empty', 'batch-only')).resolves.toBe(true)
    await expect(latestSessionAttachmentRefs(ctx, 'session-empty')).resolves.toEqual([])
    await expect(sessionAttachmentPreviewBatches(ctx, 'session-empty')).resolves.toEqual([])
    await expect(durableAttachmentRefById(ctx, String(failed.attachmentId))).resolves.toEqual(failed)
  })

  it('refuses to discard an already committed batch or a stale batch id', async () => {
    const ctx = ctxFor(await root())
    const committed = ref('d')

    await rememberAttachmentRef(ctx, committed, {
      sessionId: 'session-protect', batchId: 'batch-committed', batchIndex: 0, batchCount: 1,
    })
    await expect(commitSessionAttachmentBatch(ctx, 'session-protect', 'batch-committed')).resolves.toBe(true)

    await expect(discardSessionAttachmentBatch(ctx, 'session-protect', 'batch-committed')).resolves.toBe(false)
    await expect(discardSessionAttachmentBatch(ctx, 'session-protect', 'other-batch')).resolves.toBe(false)
    await expect(latestSessionAttachmentRefs(ctx, 'session-protect')).resolves.toEqual([committed])
  })
})
