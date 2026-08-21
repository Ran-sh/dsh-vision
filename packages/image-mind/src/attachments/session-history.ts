/**
 * Session-relative image batch resolution for model-facing history navigation.
 *
 * The model selects batches by a small recency offset only. Raw attachment ids,
 * paths and persisted batch ids remain inside the host-side attachment index.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  latestSessionAttachmentRefs,
  previewAttachmentRef,
  sessionAttachmentPreviewBatches,
} from './ref-index.ts'

export const MAX_SESSION_BATCH_OFFSET = 64

function sameRefs(left: ImageAttachmentRef[], right: ImageAttachmentRef[]): boolean {
  return left.length === right.length
    && left.every((ref, index) => ref.attachmentId === right[index]?.attachmentId)
}

async function previewRefs(
  ctx: Context,
  batchId: string,
  count: number,
): Promise<ImageAttachmentRef[]> {
  const refs: ImageAttachmentRef[] = []
  for (let index = 0; index < count; index += 1) {
    const ref = await previewAttachmentRef(ctx, batchId, index)
    if (ref === undefined) return []
    refs.push(ref)
  }
  return refs
}

/**
 * Resolve an image batch by recency within one DSH session.
 *
 * Offset 0 is the latest complete routing batch. Offset 1 is the immediately
 * previous distinct committed batch, and so on. If the current routing batch
 * is incomplete, offset 0 falls back to the newest complete committed batch.
 */
export async function sessionAttachmentRefsByOffset(
  ctx: Context,
  sessionId: string,
  offset = 0,
): Promise<ImageAttachmentRef[]> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_SESSION_BATCH_OFFSET) return []

  const latest = await latestSessionAttachmentRefs(ctx, sessionId)
  const previews = (await sessionAttachmentPreviewBatches(ctx, sessionId)).slice().reverse()
  const candidates: ImageAttachmentRef[][] = []

  if (latest.length > 0) candidates.push(latest)

  for (const preview of previews) {
    const refs = await previewRefs(ctx, preview.batchId, preview.count)
    if (refs.length === 0) continue
    if (candidates.some(candidate => sameRefs(candidate, refs))) continue
    candidates.push(refs)
  }

  return candidates[offset] ?? []
}
