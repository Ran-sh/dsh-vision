/**
 * Safe historical preview enhancer for image-mind's neutral user marker.
 *
 * The conversation log deliberately contains only `已附加图片。` (or the
 * counted variant). This module joins those durable user rows with a separate
 * host-side committed batch ledger and renders opaque preview URLs. Raw
 * attachment ids and `/image-mind/raw/` URLs never re-enter conversation text.
 */

import {
  loadSessionPreviewBatches,
  previewImageUrl,
  type SessionPreviewBatch,
} from './attach.ts'
import { PREVIEW_COMMITTED_EVENT } from './send-hook.ts'

const SESSION_ROOT = '[data-slot="conversation.session"]'
const USER_ROW = '[data-chat-flow-kind="user"]'
const PREVIEW_ATTR = 'data-dsh-image-mind-history-preview'
const PREVIEW_KEY_ATTR = 'data-dsh-image-mind-history-key'
const LIGHTBOX_ATTR = 'data-dsh-image-mind-history-lightbox'

export interface ConversationImageHistoryPreview {
  refresh(): void
  dispose(): void
}

/** Extract the image count only when the neutral marker is the final line. */
export function previewMarkerCount(text: string): number | undefined {
  const normalized = text.trimEnd()
  if (/(?:^|\n)已附加图片。$/u.test(normalized)) return 1
  const match = /(?:^|\n)已附加\s+([1-8])\s+张图片。$/u.exec(normalized)
  if (match?.[1] === undefined) return undefined
  const count = Number(match[1])
  return Number.isSafeInteger(count) && count > 0 ? count : undefined
}

/**
 * Align a rendered suffix of user markers with the committed batch history.
 * Chat history normally mounts the newest window first; walking backwards
 * keeps pagination stable when older rows are loaded later.
 */
export function alignPreviewBatches(
  markerCounts: readonly number[],
  batches: readonly SessionPreviewBatch[],
): Array<SessionPreviewBatch | undefined> {
  const aligned: Array<SessionPreviewBatch | undefined> = new Array(markerCounts.length).fill(undefined)
  let batchIndex = batches.length - 1
  for (let markerIndex = markerCounts.length - 1; markerIndex >= 0 && batchIndex >= 0; markerIndex -= 1) {
    while (batchIndex >= 0 && batches[batchIndex]?.count !== markerCounts[markerIndex]) batchIndex -= 1
    if (batchIndex < 0) break
    aligned[markerIndex] = batches[batchIndex]
    batchIndex -= 1
  }
  return aligned
}

function directPreviewChild(stack: Element): HTMLElement | undefined {
  for (const child of stack.children) {
    if (child instanceof HTMLElement && child.hasAttribute(PREVIEW_ATTR)) return child
  }
  return undefined
}

function closeLightbox(): void {
  document.querySelector<HTMLElement>(`[${LIGHTBOX_ATTR}]`)?.remove()
}

function openLightbox(src: string, alt: string): void {
  closeLightbox()
  const overlay = document.createElement('div')
  overlay.setAttribute(LIGHTBOX_ATTR, '')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', '图片预览')
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    background: 'rgba(0, 0, 0, 0.82)',
    cursor: 'zoom-out',
  })

  const image = document.createElement('img')
  image.src = src
  image.alt = alt
  Object.assign(image.style, {
    display: 'block',
    maxWidth: '96vw',
    maxHeight: '92vh',
    objectFit: 'contain',
    borderRadius: '8px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
    cursor: 'default',
  })
  image.addEventListener('click', event => event.stopPropagation())
  overlay.append(image)
  overlay.addEventListener('click', closeLightbox)

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    document.removeEventListener('keydown', onKeyDown)
    closeLightbox()
  }
  document.addEventListener('keydown', onKeyDown)
  overlay.addEventListener('DOMNodeRemoved', () => {
    document.removeEventListener('keydown', onKeyDown)
  }, { once: true })
  document.body.append(overlay)
}

function createPreview(batch: SessionPreviewBatch): HTMLElement {
  const group = document.createElement('div')
  group.setAttribute(PREVIEW_ATTR, '')
  group.setAttribute(PREVIEW_KEY_ATTR, `${batch.batchId}:${batch.count}`)
  group.setAttribute('aria-label', `已附加 ${batch.count} 张图片`)
  Object.assign(group.style, {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: '6px',
    marginBottom: '6px',
  })

  for (let index = 0; index < batch.count; index += 1) {
    const src = previewImageUrl(batch.batchId, index)
    const alt = batch.count === 1 ? '已附加图片' : `已附加图片 ${index + 1}`
    const button = document.createElement('button')
    button.type = 'button'
    button.title = '点击查看原图'
    button.setAttribute('aria-label', `查看${alt}`)
    Object.assign(button.style, {
      width: '96px',
      height: '96px',
      padding: '0',
      overflow: 'hidden',
      border: '1px solid rgba(127, 127, 127, 0.25)',
      borderRadius: '10px',
      background: 'transparent',
      cursor: 'zoom-in',
    })

    const image = document.createElement('img')
    image.src = src
    image.alt = alt
    image.loading = 'lazy'
    Object.assign(image.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    })
    button.append(image)
    button.addEventListener('click', () => openLightbox(src, alt))
    group.append(button)
  }
  return group
}

function stackForUserRow(row: HTMLElement): HTMLElement | undefined {
  const userSurface = row.querySelector<HTMLElement>('[data-time-hover-root]')
  const stack = userSurface?.firstElementChild
  return stack instanceof HTMLElement ? stack : undefined
}

function renderedMarkers(root: ParentNode): Array<{ count: number; stack: HTMLElement }> {
  const markers: Array<{ count: number; stack: HTMLElement }> = []
  for (const row of root.querySelectorAll<HTMLElement>(USER_ROW)) {
    const stack = stackForUserRow(row)
    if (stack === undefined) continue
    // The outer user row also contains host chrome such as the rendered time.
    // Match only the message stack so the neutral attachment marker can remain
    // strict and cannot be spoofed by unrelated trailing row text.
    const count = previewMarkerCount(stack.textContent ?? '')
    if (count !== undefined) markers.push({ count, stack })
  }
  return markers
}

/** Install the committed-history enhancer for the currently selected session. */
export function installConversationImageHistoryPreview(
  enabled: () => boolean,
  currentSessionId: () => string | undefined,
): ConversationImageHistoryPreview {
  let disposed = false
  let generation = 0
  let cachedSession: string | undefined
  let cachedBatches: SessionPreviewBatch[] = []
  let renderQueued = false

  const render = (): void => {
    if (disposed) return
    const root = document.querySelector<HTMLElement>(SESSION_ROOT)
    if (root === null) return
    if (!enabled()) {
      for (const preview of root.querySelectorAll<HTMLElement>(`[${PREVIEW_ATTR}]`)) preview.remove()
      return
    }

    const markers = renderedMarkers(root)
    const aligned = alignPreviewBatches(markers.map(marker => marker.count), cachedBatches)
    const assigned = new Set<HTMLElement>()
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index]
      const batch = aligned[index]
      const existing = directPreviewChild(marker.stack)
      if (batch === undefined) {
        existing?.remove()
        continue
      }
      assigned.add(marker.stack)
      const key = `${batch.batchId}:${batch.count}`
      if (existing?.getAttribute(PREVIEW_KEY_ATTR) === key) continue
      existing?.remove()
      marker.stack.prepend(createPreview(batch))
    }

    for (const preview of root.querySelectorAll<HTMLElement>(`[${PREVIEW_ATTR}]`)) {
      const parent = preview.parentElement
      if (parent !== null && !assigned.has(parent)) preview.remove()
    }
  }

  const queueRender = (): void => {
    if (renderQueued || disposed) return
    renderQueued = true
    queueMicrotask(() => {
      renderQueued = false
      render()
    })
  }

  const refresh = (): void => {
    if (disposed) return
    const sessionId = currentSessionId()
    const myGeneration = ++generation
    if (sessionId === undefined || sessionId === '') {
      cachedSession = undefined
      cachedBatches = []
      queueRender()
      return
    }
    void loadSessionPreviewBatches(sessionId).then((batches) => {
      if (disposed || generation !== myGeneration) return
      cachedSession = sessionId
      cachedBatches = batches
      queueRender()
    }, () => {
      if (disposed || generation !== myGeneration) return
      cachedSession = sessionId
      cachedBatches = []
      queueRender()
    })
  }

  const observer = new MutationObserver(queueRender)
  observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  const onCommitted = (): void => { refresh() }
  window.addEventListener(PREVIEW_COMMITTED_EVENT, onCommitted)
  refresh()

  return {
    refresh(): void {
      const next = currentSessionId()
      if (next !== cachedSession) refresh()
      else {
        // A successful commit can append a batch without changing session id.
        refresh()
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      generation += 1
      observer.disconnect()
      window.removeEventListener(PREVIEW_COMMITTED_EVENT, onCommitted)
      closeLightbox()
      for (const preview of document.querySelectorAll<HTMLElement>(`[${PREVIEW_ATTR}]`)) preview.remove()
    },
  }
}
