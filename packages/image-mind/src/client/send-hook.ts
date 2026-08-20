/**
 * Send interception: text-only models reject image blocks at submit, so a
 * send that carries draft images is rewritten into a plain-text prompt that
 * carries image-mind references instead. The images are uploaded through the
 * host attach route (so bytes stay out of the conversation log), the draft
 * images are released only after the rewritten send succeeds, and the model
 * analyzes them through the understand_image tool rather than receiving bytes
 * it cannot read.
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
 * Model-facing routing hint hidden by normal Markdown renderers. It does not
 * force needless image calls: text-only questions can proceed normally, but a
 * response that depends on pixels must use the perception tool instead of
 * hallucinating from an opaque sha256 handle.
 */
export const VISION_ROUTE_HINT = '<!-- image-mind: The image references below are opaque attachment handles, not visual descriptions. If the answer depends on image contents, call understand_image before answering and never infer pixels from the handle itself. Prefer the exact hidden [image attachment {...}] JSON metadata when present; unlike a bare sha256 id it remains resolvable after a host restart. For an image-only message, inspect the image with understand_image before replying. -->'

/** Hide one full attachment note from UI rendering while keeping it in model context. */
export function hiddenAttachmentNote(note: string): string {
  // Notes are generated from JSON, but defensively break an HTML-comment close
  // token if a future display name ever contains one.
  return `<!-- ${note.replace(/-->/g, '--\u200b>')} -->`
}

/** Build the plain-text rewrite sent to the text-only main model. */
export function buildVisionAwarePrompt(
  text: string,
  refs: readonly string[],
  notes: readonly string[] = [],
): string {
  const metadata = notes.map(hiddenAttachmentNote)
  return [text.trim(), VISION_ROUTE_HINT, ...metadata, ...refs].filter(part => part !== '').join('\n')
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
  face.sendSession = async (session, text, imageIds, mode): Promise<void> => {
    if (imageIds.length === 0) {
      return original.call(face, session, text, imageIds, mode)
    }
    const attachments = face.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      showToast('图片发送失败：草稿图片已失效，请重新选择图片后再试', 'error')
      return
    }
    const refs: string[] = []
    const notes: string[] = []
    let failureReason: string | undefined
    for (const attachment of attachments) {
      // Preflight: use the content-aware image policy before upload so OCR/UI
      // screenshots retain more detail while photographic payloads stay small.
      const prepared = await prepareImageForDescribe(attachment.file)
      if (!prepared.ok) {
        failureReason = `prepare failed: ${prepared.message}`
        break
      }
      const uploaded = await uploadImage(prepared.base64, prepared.mediaType, attachment.file.name)
      if (!uploaded.ok) {
        failureReason = `upload failed: ${uploaded.message}`
        break
      }
      refs.push(uploaded.markdown)
      notes.push(uploaded.note)
    }
    if (refs.length !== attachments.length) {
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
    const fullText = buildVisionAwarePrompt(text, refs, notes)
    const result = await session.prompt([{ type: 'text', text: fullText }], mode)
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
