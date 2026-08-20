/**
 * Send interception: text-only models reject image blocks at submit, so a
 * send that carries draft images is rewritten into a plain-text prompt. The
 * images are uploaded through the host attach route (so bytes and durable
 * attachment metadata stay out of the conversation text), the draft images
 * are released only after the rewritten send succeeds, and the model analyzes
 * them through the understand_image tool rather than receiving image bytes.
 * @module dsh-plugin-image-mind/client/send_hook
 */

import { prepareImageForDescribe, uploadImage } from './attach.ts'
import { showToast } from './toast.ts'

/** One draft image as the conversation service hands it back. */
interface DraftImageFace {
  readonly id: string
  readonly file: File
}

/** One text prompt block. */
interface TextBlock { type: 'text'; text: string }

/** Prompt result shape returned by the session RPC. */
interface PromptResult { ok: boolean; error?: { code: string; message?: string } }

/** The session face needed to re-send a text-only prompt. */
interface SessionPromptFace {
  /** DSH session/agent identity; used only as a server-side attachment lookup key. */
  readonly sessionId?: string
  prompt(content: readonly TextBlock[], mode: string, signal?: AbortSignal): Promise<PromptResult>
}

/** The conversation-service surface this hook wraps. */
interface ConversationSendFace {
  send(text: string): Promise<void>
  sendSession(session: SessionPromptFace, text: string, imageIds: readonly string[], mode: string, signal?: AbortSignal): Promise<unknown>
  draftImages(ids: readonly string[]): readonly DraftImageFace[]
  releaseDraftImage(id: string): void
}

/** Installed-marker key on the wrapped service instance. */
const HOOK_MARKER = '__dshImageMindSendHooked'

/**
 * User-safe routing marker. DSH currently renders the submitted text verbatim
 * in the user bubble, so HTML comments are NOT a hidden channel. Keep this
 * message deliberately free of attachment ids, raw URLs, dimensions, byte
 * counts, file metadata, or other host-only routing facts.
 */
export const VISION_ROUTE_HINT = '已附加图片。若回答依赖图片内容，请先调用 understand_image 查看图片，不要根据附件占位信息猜测。'

/** Build the text-only rewrite without leaking host attachment metadata. */
export function buildVisionAwarePrompt(text: string, imageCount = 1): string {
  const count = Number.isSafeInteger(imageCount) && imageCount > 0 ? imageCount : 1
  const marker = count === 1 ? VISION_ROUTE_HINT : `已附加 ${count} 张图片。若回答依赖图片内容，请先调用 understand_image 查看图片，不要猜测。`
  return [text.trim(), marker].filter(part => part !== '').join('\n')
}

/**
 * Wrap the conversation service so image-bearing sends route through the
 * image-mind attach seam. No-op when the service surface is unavailable
 * (older shell) or already wrapped.
 * @param conversation - the `conversation` service instance.
 */
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
    const attachments = face.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      showToast('图片发送失败：草稿图片已失效，请重新选择图片后再试', 'error')
      return
    }
    const sessionId = typeof session.sessionId === 'string' ? session.sessionId.trim() : ''
    if (sessionId === '') {
      // Without a stable DSH session identity there is no safe way to keep the
      // routing metadata off the user-visible prompt while still letting the
      // host tool resolve the just-uploaded images. Fail closed and preserve
      // drafts instead of falling back to leaking refs into conversation text.
      showToast('图片发送失败：当前 DSH 会话缺少可用的 sessionId；草稿图片已保留', 'error')
      return
    }

    const batchId = crypto.randomUUID()
    let uploadedCount = 0
    let failureReason: string | undefined
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index]
      // Preflight: use the content-aware image policy before upload so OCR/UI
      // screenshots retain more detail while photographic payloads stay small.
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
      // Fail closed. Falling back to the shell's raw image send is a known
      // failure for text-only main models and can also discard the user's
      // retry opportunity. Keep every draft image intact so the user can send
      // again after fixing the transient prepare/upload problem.
      if (typeof console !== 'undefined') {
        console.warn(`[image-mind] image send blocked because rewrite did not complete (${failureReason ?? 'unknown'})`)
      }
      showToast(`图片发送失败：${failureReason ?? '未知原因'}；草稿图片已保留，可直接重试`, 'error')
      return
    }
    const fullText = buildVisionAwarePrompt(text, attachments.length)
    const result = await session.prompt([{ type: 'text', text: fullText }], mode, signal)
    if (!result.ok) {
      // The rewrite succeeded but the conversation send did not. Keep the
      // drafts for retry; release only after a successful session.prompt.
      showToast(`图片发送失败：${result.error?.message ?? result.error?.code ?? '会话发送失败'}；草稿图片已保留`, 'error')
      return
    }
    for (const id of imageIds) face.releaseDraftImage(id)
    showToast('图片已就绪：发送后模型可通过 understand_image 分析')
  }
  ;(face as unknown as Record<string, unknown>)[HOOK_MARKER] = true
}
