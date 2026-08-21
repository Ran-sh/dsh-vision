/** @vitest-environment node */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { commitSessionAttachmentBatch, rememberAttachmentRef } from '../src/attachments/ref-index.ts'
import { MAX_SESSION_BATCH_OFFSET, sessionAttachmentRefsByOffset } from '../src/attachments/session-history.ts'

const roots: string[] = []

async function ctxForTest(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'image-mind-session-history-'))
  roots.push(root)
  return {
    get(key: string) {
      return key === 'attachments' ? { root } : undefined
    },
  } as unknown as Context
}

function ref(char: string): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${char.repeat(64)}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 123,
    width: 40,
    height: 30,
  }
}

async function rememberBatch(
  ctx: Context,
  sessionId: string,
  batchId: string,
  refs: ImageAttachmentRef[],
  commit = true,
): Promise<void> {
  for (let index = 0; index < refs.length; index += 1) {
    await rememberAttachmentRef(ctx, refs[index], {
      sessionId,
      batchId,
      batchIndex: index,
      batchCount: refs.length,
    })
  }
  if (commit) await commitSessionAttachmentBatch(ctx, sessionId, batchId)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('session image history routing', () => {
  it('resolves latest and previous distinct committed batches without exposing ids to the caller', async () => {
    const ctx = await ctxForTest()
    const first = ref('a')
    const second = ref('b')

    await rememberBatch(ctx, 's1', 'batch-a', [first])
    await rememberBatch(ctx, 's1', 'batch-b', [second])

    await expect(sessionAttachmentRefsByOffset(ctx, 's1', 0)).resolves.toEqual([second])
    await expect(sessionAttachmentRefsByOffset(ctx, 's1', 1)).resolves.toEqual([first])
    await expect(sessionAttachmentRefsByOffset(ctx, 's1', 2)).resolves.toEqual([])
  })

  it('keeps an uncommitted current batch at offset zero and the previous committed batch at offset one', async () => {
    const ctx = await ctxForTest()
    const previous = ref('c')
    const current = ref('d')

    await rememberBatch(ctx, 's2', 'previous', [previous])
    await rememberBatch(ctx, 's2', 'current', [current], false)

    await expect(sessionAttachmentRefsByOffset(ctx, 's2', 0)).resolves.toEqual([current])
    await expect(sessionAttachmentRefsByOffset(ctx, 's2', 1)).resolves.toEqual([previous])
  })

  it('falls back to the newest committed batch when the current routing batch is incomplete', async () => {
    const ctx = await ctxForTest()
    const committed = ref('e')
    const incomplete = ref('f')

    await rememberBatch(ctx, 's3', 'committed', [committed])
    await rememberAttachmentRef(ctx, incomplete, {
      sessionId: 's3', batchId: 'incomplete', batchIndex: 0, batchCount: 2,
    })

    await expect(sessionAttachmentRefsByOffset(ctx, 's3', 0)).resolves.toEqual([committed])
  })

  it('fails closed for invalid offsets', async () => {
    const ctx = await ctxForTest()
    await expect(sessionAttachmentRefsByOffset(ctx, 's4', -1)).resolves.toEqual([])
    await expect(sessionAttachmentRefsByOffset(ctx, 's4', MAX_SESSION_BATCH_OFFSET + 1)).resolves.toEqual([])
  })
})
