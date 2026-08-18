/**
 * Minimal non-blocking toast for image-mind: fixed top-right, auto-dismissing,
 * with prefixed classes so it never collides with the shell. Used to surface
 * drag/paste send outcomes without any shell dependency.
 * @module dsh-plugin-image-mind/client/toast
 */

/** Toast style injected once per document. */
const TOAST_CSS = [
  '.image-mind-toast { position: fixed; top: 16px; right: 16px; z-index: 2147483000; max-width: 340px; border-radius: 8px; padding: 10px 14px; font-size: 13px; line-height: 1.5; box-shadow: 0 4px 16px rgba(0,0,0,.18); border: 1px solid var(--dsw-alias-border-l2, #d9d9d9); color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-3, #fff); animation: imageMindToastIn .16s ease; }',
  '.image-mind-toast-error { border-color: var(--dsw-alias-label-error, #d93636); }',
  '@keyframes imageMindToastIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }',
].join('\n')

/** Show one auto-dismissing toast. */
export function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  if (document.querySelector('style[data-plugin-toast-css="image-mind"]') === null) {
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin-toast-css', 'image-mind')
    tag.textContent = TOAST_CSS
    document.head.append(tag)
  }
  const element = document.createElement('div')
  element.className = kind === 'error' ? 'image-mind-toast image-mind-toast-error' : 'image-mind-toast'
  element.setAttribute('role', 'status')
  element.textContent = message
  document.body.append(element)
  window.setTimeout(() => { element.remove() }, 3500)
}
