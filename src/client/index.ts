/**
 * Browser half of the image-mind plugin. Three interlocking pieces:
 *
 * 1. Send interception (installSendHook): the shell's input box has no image
 *    entry for text-only models, so image-bearing sends are rewritten at
 *    submit time into image-mind references before they reach the model.
 * 2. Conversation preview (installConversationImagePreview): the shell renders
 *    user messages as plain text, so a sent reference is upgraded in place
 *    into an inline thumbnail unless the config turns previews off (read from
 *    the host `/image-mind/config` gateway, not the official settings scope —
 *    its allowlist is hardcoded to product namespaces).
 * 3. Settings card (ImageMindSettingsCardController): a card registered into
 *    the official `settings.plugin.item` slot, so 设置 → 插件 → 插件配置 shows
 *    the endpoint/model/key form, backed by the plugin's own config gateway.
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
import { RemoteConfigScope } from './remote-scope.ts'
import { peekConfig, subscribeConfig } from './config-client.ts'
import { localeDictionaries, mirrorDocumentLanguage, type CardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The image-mind card copy. */
    'image-mind': CardKey
  }
}

/** Plugin id; matches the host half and the settings namespace. */
export const name = 'image-mind'

/** Required services: conversation, slots, locale. */
export const inject = ['conversation', 'slots', 'locale']

/** Locale namespace owned by this client half (card copy lives in our own dictionary). */
export const NS = 'image-mind'

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
  // thumbnail unless the deployment turns previews off. The toggle reads the
  // config gateway's cache, refreshed on every card save.
  let previewRef: ConversationImagePreview | undefined
  const unsubscribeConfig = subscribeConfig(() => previewRef?.refresh())
  ctx.effect(() => {
    const handle = installConversationImagePreview(() => {
      const cached = peekConfig()
      return cached?.value.renderImagePreview !== false
    })
    previewRef = handle
    return () => {
      unsubscribeConfig()
      previewRef = undefined
      handle.dispose()
    }
  }, 'dsh-plugin-image-mind: conversation image preview')

  // Remote scope over the host config gateway; the settings card edits the
  // same section the host tool reads on every understand_image call.
  const settingsScope = new RemoteConfigScope()
  ctx.inject(['slots'], (slotsCtx: ClientContext) => {
    const settingsCard = new ImageMindSettingsCardController(settingsScope)
    slotsCtx.slots.inject('settings.plugin.item', () =>
      slotsCtx.slots.register({
        name: 'settings.plugin.item',
        id: 'image-mind',
        order: 30,
        locale: NS,
        inject: () => settingsCard.inject(),
      }, ImageMindSettingsCard))
  })
}