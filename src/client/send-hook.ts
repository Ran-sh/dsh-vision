/**
 * Send interception: text-only models reject image blocks at submit, so a
 * send that carries draft images is rewritten into a plain-text prompt that
 * carries image-mind references instead. The images are uploaded through the
 * host attach route (so bytes stay out of the conversation log), the draft
 * images are released, and the model analyzes them through the
 * understand_image tool rather than receiving the bytes it cannot read.
 *
 * The hook wraps the conversation service's sendSession method in place. It
 * is structural (no dependency on the conversation package's internal
 * types) and idempotent (a module marker guards against double install).
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
  prompt(content: readonly TextBlock[], mode: string): Promise<PromptResult>
}

/** The conversation-service surface this hook wraps. */
interface ConversationSendFace {
  send(text: string): Promise<void>
  sendSession(session: SessionPromptFace, text: string, imageIds: readonly string[], mode: string): Promise<void>
  draftImages(ids: readonly string[]): readonly DraftImageFace[]
  releaseDraftImage(id: string): void
}

/** Installed-marker key on the wrapped service instance. */
const HOOK_MARKER = '__dshImageMindSendHooked'

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
  face.sendSession = async (session, text, imageIds, mode): Promise<void> => {
    if (imageIds.length === 0) {
      return original.call(face, session, text, imageIds, mode)
    }
    const attachments = face.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      return original.call(face, session, text, imageIds, mode)
    }
    const refs: string[] = []
    let fallbackReason: string | undefined
    for (const attachment of attachments) {
      // Prelight: downscale oversized images before upload so the vision
      // model is billed on what it actually needs.
      const prepared = await prepareImageForDescribe(attachment.file)
      if (!prepared.ok) {
        fallbackReason = `prepare failed: ${prepared.message}`
        break
      }
      const uploaded = await uploadImage(prepared.base64, prepared.mediaType, attachment.file.name)
      if (!uploaded.ok) {
        fallbackReason = `upload failed: ${uploaded.message}`
        break
      }
      refs.push(uploaded.markdown)
    }
    if (refs.length !== attachments.length) {
      // Upload fell short: keep the shell's original behavior (which will
      // reject the image block for a text-only model), but say why so the
      // failure is visible instead of silent.
      if (typeof console !== 'undefined') {
        console.warn(`[image-mind] image send not rewritten (${fallbackReason ?? 'unknown'}); falling back to the shell's raw image send`)
      }
      showToast(`图片发送失败：${fallbackReason ?? '未知原因'}`, 'error')
      return original.call(face, session, text, imageIds, mode)
    }
    const fullText = [text.trim(), ...refs].filter(part => part !== '').join('\n')
    const result = await session.prompt([{ type: 'text', text: fullText }], mode)
    if (!result.ok) {
      throw new Error(`conversation.send failed: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`)
    }
    for (const id of imageIds) face.releaseDraftImage(id)
    showToast('图片已就绪：发送后模型可通过 understand_image 分析')
  }
  ;(face as unknown as Record<string, unknown>)[HOOK_MARKER] = true
}
