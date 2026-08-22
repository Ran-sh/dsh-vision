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
  }): unknown
}

/**
 * Re-run `attach` for every distinct webServer instance exposed by the
 * Cordis lifecycle. The callback receives the injected context (the service
 * is guaranteed available inside). Registration is idempotent per server
 * lifecycle: the host route registry rejects duplicate `(kind, path)`
 * patterns, so a re-fire for an already-attached instance (the owning fiber
 * can restart while returning the same server) must not call `attach` twice.
 */
export function observeWebServerLifecycle(ctx: Context, attach: (injected: Context) => void): void {
  const attached = new WeakSet<object>()
  ;(ctx as unknown as {
    inject(names: string[], callback: (injected: Context) => void): void
  }).inject(['webServer'], (injected) => {
    const server = injected.get('webServer') as PrefixRouteServer | undefined
    if (server === undefined || attached.has(server)) return
    attached.add(server)
    attach(injected)
  })
}
