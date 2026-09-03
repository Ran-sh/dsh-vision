/**
 * The Cordis service-lifecycle seam that puts plugin web routes onto the DSH
 * webServer. This replaces a bounded setTimeout poll that could give up
 * before a slow server appeared and stopped listening after its first hit,
 * missing a replaced server implementation entirely. The inject seam instead
 * fires exactly when the service is usable — immediately when it already
 * exists, later when it first appears, and again whenever its owning fiber
 * changes — without any timer ownership.
 * @module dsh-plugin-image-mind/runtime/webserver-lifecycle
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** Minimal structural view of the host webServer route registry. */
export interface PrefixRouteServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Re-run `attach` for every webServer lifecycle exposed by Cordis. The
 * callback receives the injected context (the service is guaranteed
 * available inside) and may return a disposer that tears down what it
 * registered. Route ownership belongs to the fiber/disposer — not to object
 * identity — so an unload/reload cycle on the same server instance
 * unregisters then re-registers cleanly instead of leaking a stale route
 * or skipping the re-registration.
 */
export function observeWebServerLifecycle(ctx: Context, attach: (injected: Context) => (() => void) | void): void {
  ;(ctx as unknown as {
    inject(names: string[], callback: (injected: Context) => void): void
  }).inject(['webServer'], (injected) => {
    injected.effect(() => attach(injected) ?? (() => {}), 'image-mind: /image-mind routes')
  })
}
