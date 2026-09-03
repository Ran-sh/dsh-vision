/**
 * Browser half of the image-mind plugin.
 *
 * Image sends are rewritten for text-only main models, historical image
 * presentation is reconstructed from a separate committed host ledger, legacy
 * markdown previews remain supported, and the settings card stays on DSH's
 * official settings seam.
 * @module dsh-plugin-image-mind/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { installSendHook } from './send-hook.ts'
import { installConversationImagePreview, type ConversationImagePreview } from './preview.ts'
import { installConversationImageHistoryPreview } from './history-preview.ts'
import { ImageMindSettingsCard, ImageMindSettingsCardController } from './settings-card.tsx'
import { localeDictionaries, mirrorDocumentLanguage, type CardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'image-mind': CardKey
  }
}

export const name = 'image-mind'

/** Runtime provides the active-session observable used by safe history previews. */
export const inject = ['conversation', 'slots', 'locale', 'sessions', 'settingsScope', 'remote']

export const NS = 'image-mind'

let previewToggle = true

export function getPreviewToggle(): boolean {
  return previewToggle
}

export function setPreviewToggle(enabled: boolean): void {
  previewToggle = enabled
}

export function apply(ctx: Context): void {
  ctx.effect(() => mirrorDocumentLanguage(), 'dsh-plugin-image-mind: language mirror')
  ctx.effect(() => ctx.locale.register(NS, localeDictionaries), 'dsh-plugin-image-mind: card dictionaries')

  ctx.inject(['conversation'], (scope: Context) => {
    installSendHook(scope.conversation)
  })

  // Keep the old markdown enhancer for already persisted legacy messages.
  let previewRef: ConversationImagePreview | undefined
  ctx.effect(() => {
    const handle = installConversationImagePreview(() => getPreviewToggle())
    previewRef = handle
    return () => {
      previewRef = undefined
      handle.dispose()
    }
  }, 'dsh-plugin-image-mind: legacy conversation image preview')

  // New secrecy-safe history path: the transcript contains only the neutral
  // marker, while the selected session id addresses a separate committed
  // preview ledger. No attachment id or raw URL is written into conversation
  // text to make this work.
  ctx.inject(['sessions'], (scope: Context) => {
    const sessions = scope.get('sessions')
    if (sessions === undefined) return
    const handle = installConversationImageHistoryPreview(
      () => getPreviewToggle(),
      () => sessions.list.getSnapshot().current,
    )
    const unsubscribe = sessions.list.subscribe(() => handle.refresh())
    scope.effect(() => () => {
      unsubscribe()
      handle.dispose()
    }, 'dsh-plugin-image-mind: committed conversation image preview')
  })

  ctx.inject(['slots'], (slotsCtx: Context) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slots = (slotsCtx as any).slots
    const controller = new ImageMindSettingsCardController(slotsCtx)
    slotsCtx.effect(() => () => controller.dispose(), 'dsh-plugin-image-mind: settings card controller')
    slots.inject('settings.plugin.item', () =>
      slots.register({
        name: 'settings.plugin.item',
        key: NS,
        locale: NS,
        inject: () => controller.inject(),
      }, ImageMindSettingsCard))
  })
}
