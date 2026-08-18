/**
 * Browser half of the image-mind plugin. Three interlocking pieces:
 *
 * 1. Send interception (installSendHook): the shell's input box has no image
 *    entry for text-only models, so image-bearing sends are rewritten at
 *    submit time into image-mind references before they reach the model.
 * 2. Conversation preview (installConversationImagePreview): the shell renders
 *    user messages as plain text, so a sent reference is upgraded in place
 *    into an inline thumbnail unless the config turns previews off.
 * 3. Settings card (ImageMindSettingsCardController): a card registered into
 *    the official `settings.plugin.item` slot, so 设置 → 插件 → 插件配置 shows
 *    the endpoint/model/key form. The card reads and writes the `image-mind`
 *    namespace through the OFFICIAL settings seam (`connection.api.settings`
 *    describe/mutate), so secrets stay redacted on the wire and typed keys go
 *    into the credential store — never into `settings.yaml`.
 *
 * Failure policy: every DOM/runtime wiring failure is logged, never thrown —
 * the web shell fails the whole boot when a plugin apply throws.
 * @module dsh-plugin-image-mind/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Module augmentations: `conversation` (send hook) and locale/registry types.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { installSendHook } from './send-hook.ts'
import { installConversationImagePreview, type ConversationImagePreview } from './preview.ts'
import { ImageMindSettingsCard, ImageMindSettingsCardController } from './settings-card.tsx'
import { localeDictionaries, mirrorDocumentLanguage, type CardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The image-mind card copy. */
    'image-mind': CardKey
  }
}

/** Plugin id; matches the host half and the settings namespace. */
export const name = 'image-mind'

/** Required services: conversation, slots, locale, connection. */
export const inject = ['conversation', 'slots', 'locale', 'connection']

/** Locale namespace owned by this client half (card copy lives in our own dictionary). */
export const NS = 'image-mind'

/** Module-level preview-toggle cache; refreshed by the settings store's loads. */
let previewToggle = true

/** The current preview-toggle value (read by the conversation enhancer). */
export function getPreviewToggle(): boolean {
  return previewToggle
}

/** Refresh the preview-toggle cache from a settings value. */
export function setPreviewToggle(enabled: boolean): void {
  previewToggle = enabled
}

/**
 * Apply the browser half.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  // Mirror the shell language into the card dictionary; stop watching on
  // unload so a long-lived boot never leaks observers.
  ctx.effect(() => mirrorDocumentLanguage(), 'dsh-plugin-image-mind: language mirror')
  // Register the card dictionary with the shell locale so the slot entry's
  // locale field resolves; the card itself reads its own module dictionary.
  ctx.effect(() => ctx.locale.register(NS, localeDictionaries), 'dsh-plugin-image-mind: card dictionaries')

  // Text-only models reject image blocks at submit: rewrite image-bearing
  // sends into image-mind references before they reach the model.
  ctx.inject(['conversation'], (scope: ClientContext) => {
    installSendHook(scope.conversation)
  })

  // The shell renders user messages as plain text, so a sent reference sits
  // in the transcript as raw markdown; upgrade it in place into an inline
  // thumbnail unless the deployment turns previews off. The toggle is read
  // from a module cache refreshed on every settings load, so edits apply
  // without a reload.
  let previewRef: ConversationImagePreview | undefined
  ctx.effect(() => {
    const handle = installConversationImagePreview(() => getPreviewToggle())
    previewRef = handle
    return () => {
      previewRef = undefined
      handle.dispose()
    }
  }, 'dsh-plugin-image-mind: conversation image preview')

  // The settings card: reads and writes the `image-mind` namespace through
  // the official settings seam.
  ctx.inject(['slots'], (slotsCtx: ClientContext) => {
    const controller = new ImageMindSettingsCardController(slotsCtx)
    slotsCtx.slots.inject('settings.plugin.item', () =>
      slotsCtx.slots.register({
        name: 'settings.plugin.item',
        key: 'image-mind',
        locale: NS,
        inject: () => controller.inject(),
      }, ImageMindSettingsCard))
  })
}
