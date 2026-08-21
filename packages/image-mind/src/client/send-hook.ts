/**
 * Send interception: text-only models reject image blocks at submit, so a
 * send that carries draft images is rewritten into a plain-text prompt. The
 * images are uploaded through the host attach route (so bytes and durable
 * attachment metadata stay out of the conversation text), the draft images
 * are released only after the rewritten send succeeds, and the model analyzes
 * them through the understand_image tool rather than receiving image bytes.
 * @module dsh-plugin-image-mind/client/send_hook
 */

import { MAX_IMAGES_PER_REQUEST } from '../shared/image-limits.ts'
import { commitImagePreviewBatch, prepareImageForDescribe, uploadImage } from './attach.ts'
import { showToast } from './toast.ts'

interface DraftImageFace {
  readonly id: string
  readonly file: File
}

interface TextBlock { type: 'text'; text: string }
interface PromptResult { ok: boolean; error?: { code: string; message?: string } }

interface SessionPromptFace {
  readonly sessionId?: string
  prompt(content: readonly TextBlock[], mode: string, signal?: AbortSignal): Promise<PromptResult>
}

interface ConversationSendFace {
  send(text: string): Promise<void>
  sendSession(session: SessionPromptFace, text: string, imageIds: readonly string[], mode: string, signal?: AbortSignal): Promise<unknown>
  draftImages(ids: readonly string[]): readonly DraftImageFace[]
  releaseDraftImage(id: string): void
}

const HOOK_MARKER = '__dshImageMindSendHooked'
export const PREVIEW_COMMITTED_EVENT = 'dsh-image-mind:preview-committed'

/**
 * User-visible attachment marker. It deliberately carries no tool-routing
 * instruction, attachment id, raw URL, or host metadata.
 */
export const VISION_ATTACHMENT_MARKER = '已附加图片。'

export function buildVisionAwarePrompt(text: string, imageCount = 1): string {
  const count = Number.isSafeInteger(imageCount) && imageCount > 0 ? imageCount : 1
  const marker = count === 1 ? VISION_ATTACHMENT_MARKER : `已附加 ${count} 张图片。`
  return [text.trim(), marker].filter(part => part !== '').join('\n')
}

export function installSendHook(conversation: unknown): void {
  const face = conversation as ConversationSendFace
  if (face === null || typeof face !== 'object') return
  if (typeof face.sendSession !== 'function') return
  if (typeof face.draftImages !== 'function' || typeof face.releaseDraftImage !== 'function') return
  if ((face as unknown as Record<string, unknown>)[HOOK_MARKER] === true) return

  const original = face.sendSession
  face.sendSession = async (session, text, imageIds, mode, signal): Promise<void> => {
    if (imageIds.length === 0) {
      await original.call(face, session, text, imageIds, mode, signal)
      return
    }
    if (imageIds.length > MAX_IMAGES_PER_REQUEST) {
      showToast(`图片发送失败：一次最多 ${MAX_IMAGES_PER_REQUEST} 张；草稿图片已保留，请减少后重试`, 'error')
      return
    }
    const attachments = face.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      showToast('图片发送失败：草稿图片已失效，请重新选择图片后再试', 'error')
      return
    }
    const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : ''
    if (sessionId === '') {
      showToast('图片发送失败：当前 DSH 会话缺少可用的 sessionId；草稿图片已保留', 'error')
      return
    }

    const batchId = crypto.randomUUID()
    let uploadedCount = 0
    let failureReason: string | undefined
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index]
      const prepared = await prepareImageForDescribe(attachment.file)
      if (!prepared.ok) {
        failureReason = `prepare failed: ${prepared.message}`
        break
      }
      const uploaded = await uploadImage(
        prepared.base64,
        prepared.mediaType,
        attachment.file.name,
        { sessionId, batchId, batchIndex: index, batchCount: attachments.length },
      )
      if (!uploaded.ok) {
        failureReason = `upload failed: ${uploaded.message}`
        break
      }
      uploadedCount += 1
    }
    if (uploadedCount !== attachments.length) {
      if (typeof console !== 'undefined') {
        console.warn(`[image-mind] image send blocked because rewrite did not complete (${failureReason ?? 'unknown'})`)
      }
      showToast(`图片发送失败：${failureReason ?? '未知原因'}；草稿图片已保留，可直接重试`, 'error')
      return
    }

    const fullText = buildVisionAwarePrompt(text, attachments.length)
    const result = await session.prompt([{ type: 'text', text: fullText }], mode, signal)
    if (!result.ok) {
      showToast(`图片发送失败：${result.error?.message ?? result.error?.code ?? '会话发送失败'}；草稿图片已保留`, 'error')
      return
    }

    // Only successful conversation admission promotes an upload batch into the
    // historical preview ledger. A display-ledger failure must never retry the
    // already admitted user message (which would duplicate it), so degrade to
    // a warning while preserving the successful send.
    const previewCommit = await commitImagePreviewBatch(sessionId, batchId)
    if (!previewCommit.ok && typeof console !== 'undefined') {
      console.warn(`[image-mind] message sent but preview history commit failed (${previewCommit.message})`)
    }

    for (const id of imageIds) face.releaseDraftImage(id)
    if (previewCommit.ok && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(PREVIEW_COMMITTED_EVENT))
    }
    showToast(previewCommit.ok
      ? '图片已就绪：发送后模型可通过 understand_image 分析'
      : '图片已发送，但历史缩略图暂不可用；模型仍可正常分析')
  }
  ;(face as unknown as Record<string, unknown>)[HOOK_MARKER] = true
}
