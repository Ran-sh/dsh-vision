/** @vitest-environment node */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  commitSessionAttachmentBatch,
  durableAttachmentRefById,
  latestSessionAttachmentRefs,
  previewAttachmentRef,
  rememberAttachmentRef,
  sessionAttachmentPreviewBatches,
} from '../src/attachments/ref-index.ts'

const roots: string[] = []

function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'image-mind-ref-index-')).then((value) => {
    roots.push(value)
    return value
  })
}

function ctxFor(attachmentRoot: string): Context {
  return {
    get(key: string) {
      return key === 'attachments' ? { root: attachmentRoot } : undefined
    },
  } as unknown as Context
}

function ref(idChar: string, name?: string): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${idChar.repeat(64)}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 123,
    width: 40,
    height: 30,
    ...(name === undefined ? {} : { name }),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('durable attachment reference index', () => {
  it('persists a complete reference and latest ordered session batch', async () => {
    const attachmentRoot = await root()
    const ctx = ctxFor(attachmentRoot)
    const first = ref('a', 'first.png')
    const second = ref('b', 'second.png')

    await rememberAttachmentRef(ctx, first, {
      sessionId: 'session-1', batchId: 'batch-1', batchIndex: 0, batchCount: 2,
    })
    await rememberAttachmentRef(ctx, second, {
      sessionId: 'session-1', batchId: 'batch-1', batchIndex: 1, batchCount: 2,
    })

    await expect(durableAttachmentRefById(ctx, String(first.attachmentId))).resolves.toEqual(first)
    await expect(latestSessionAttachmentRefs(ctx, 'session-1')).resolves.toEqual([first, second])

    const persisted = JSON.parse(await readFile(
      join(attachmentRoot, '.image-mind', 'attachment-index-v1.json'),
      'utf8',
    )) as { version: number; refs: Record<string, unknown>; sessions: Record<string, unknown> }
    expect(persisted.version).toBe(1)
    expect(persisted.refs[String(first.attachmentId)]).toEqual(first)
    expect(persisted.refs[String(second.attachmentId)]).toEqual(second)
    expect(persisted.sessions['session-1']).toBeDefined()
  })

  it('commits only complete successful batches into the preview ledger', async () => {
    const attachmentRoot = await root()
    const ctx = ctxFor(attachmentRoot)
    const first = ref('1')
    const second = ref('2')

    await rememberAttachmentRef(ctx, first, {
      sessionId: 'session-preview', batchId: 'batch-preview', batchIndex: 0, batchCount: 2,
    })
    await expect(commitSessionAttachmentBatch(ctx, 'session-preview', 'batch-preview')).resolves.toBe(false)
    await expect(sessionAttachmentPreviewBatches(ctx, 'session-preview')).resolves.toEqual([])

    await rememberAttachmentRef(ctx, second, {
      sessionId: 'session-preview', batchId: 'batch-preview', batchIndex: 1, batchCount: 2,
    })
    await expect(commitSessionAttachmentBatch(ctx, 'session-preview', 'batch-preview')).resolves.toBe(true)
    await expect(sessionAttachmentPreviewBatches(ctx, 'session-preview')).resolves.toEqual([
      expect.objectContaining({ batchId: 'batch-preview', count: 2 }),
    ])
    await expect(previewAttachmentRef(ctx, 'batch-preview', 0)).resolves.toEqual(first)
    await expect(previewAttachmentRef(ctx, 'batch-preview', 1)).resolves.toEqual(second)
  })

  it('keeps committed history independent from a newer uncommitted routing batch', async () => {
    const attachmentRoot = await root()
    const ctx = ctxFor(attachmentRoot)
    const committed = ref('3')
    const pending = ref('4')

    await rememberAttachmentRef(ctx, committed, {
      sessionId: 'session-history', batchId: 'committed', batchIndex: 0, batchCount: 1,
    })
    await expect(commitSessionAttachmentBatch(ctx, 'session-history', 'committed')).resolves.toBe(true)
    await rememberAttachmentRef(ctx, pending, {
      sessionId: 'session-history', batchId: 'pending', batchIndex: 0, batchCount: 1,
    })

    await expect(latestSessionAttachmentRefs(ctx, 'session-history')).resolves.toEqual([pending])
    await expect(sessionAttachmentPreviewBatches(ctx, 'session-history')).resolves.toEqual([
      expect.objectContaining({ batchId: 'committed', count: 1 }),
    ])
    await expect(previewAttachmentRef(ctx, 'committed', 0)).resolves.toEqual(committed)
    await expect(previewAttachmentRef(ctx, 'pending', 0)).resolves.toBeUndefined()
  })

  it('cold-loads a complete reference and ordered session batch from disk', async () => {
    const attachmentRoot = await root()
    const indexDir = join(attachmentRoot, '.image-mind')
    await mkdir(indexDir, { recursive: true })
    const first = ref('c')
    const second = ref('d')
    await writeFile(join(indexDir, 'attachment-index-v1.json'), JSON.stringify({
      version: 1,
      refs: {
        [String(first.attachmentId)]: first,
        [String(second.attachmentId)]: second,
      },
      sessions: {
        'resumed-session': {
          batchId: 'old-batch',
          count: 2,
          refs: {
            '0': String(first.attachmentId),
            '1': String(second.attachmentId),
          },
          updatedAt: 1234,
        },
      },
    }), 'utf8')

    const cold = ctxFor(attachmentRoot)
    await expect(durableAttachmentRefById(cold, String(second.attachmentId))).resolves.toEqual(second)
    await expect(latestSessionAttachmentRefs(cold, 'resumed-session')).resolves.toEqual([first, second])
    await expect(sessionAttachmentPreviewBatches(cold, 'resumed-session')).resolves.toEqual([])
  })

  it('fails closed to no references when persisted metadata is malformed', async () => {
    const attachmentRoot = await root()
    const indexDir = join(attachmentRoot, '.image-mind')
    await mkdir(indexDir, { recursive: true })
    await writeFile(join(indexDir, 'attachment-index-v1.json'), '{ definitely-not-json', 'utf8')

    const cold = ctxFor(attachmentRoot)
    await expect(durableAttachmentRefById(cold, `sha256:${'e'.repeat(64)}`)).resolves.toBeUndefined()
    await expect(latestSessionAttachmentRefs(cold, 'session')).resolves.toEqual([])
  })

  it('does not expose an incomplete session batch as if all images were available', async () => {
    const attachmentRoot = await root()
    const indexDir = join(attachmentRoot, '.image-mind')
    await mkdir(indexDir, { recursive: true })
    const first = ref('f')
    await writeFile(join(indexDir, 'attachment-index-v1.json'), JSON.stringify({
      version: 1,
      refs: { [String(first.attachmentId)]: first },
      sessions: {
        session: {
          batchId: 'incomplete',
          count: 2,
          refs: { '0': String(first.attachmentId) },
          updatedAt: 999,
        },
      },
    }), 'utf8')

    await expect(latestSessionAttachmentRefs(ctxFor(attachmentRoot), 'session')).resolves.toEqual([])
  })
})
