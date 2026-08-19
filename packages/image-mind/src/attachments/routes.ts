/**
 * The /image-mind host routes: a browser-to-host upload seam that turns a
 * picked image into a durable attachment reference, plus the raw route that
 * serves stored bytes so a pasted reference renders in the conversation, plus
 * thin vision RPC (test connection / model discovery) for the settings card.
 * The upload returns the `[image attachment …]` note and the markdown
 * reference the browser half splices into the send; the image bytes
 * themselves never cross into the conversation log — they live in the
 * attachment store.
 *
 * Settings persistence lives in the official settings seam (the card reads
 * and writes through `connection.api.settings` describe/mutate); the legacy
 * `/image-mind/config` GET/POST routes remain only as a compatibility
 * transport for older clients, served from the same in-process settings
 * provider.
 * @module dsh-plugin-image-mind/attachments/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { decodeBase64, isImageMimeType, sniffMimeType, type ImageMimeType } from '../media/validate.ts'
import { DEFAULT_MAX_BYTES } from '../media/types.ts'
import { readBoundedBody } from '../media/load.ts'
import { handleAttach } from './routes-core.ts'
import { ROUTE_PREFIX } from './store.ts'

export { ROUTE_PREFIX }

/** Request-body byte cap: base64 of a 10 MiB image plus envelope slack. */
export const MAX_ATTACH_BODY_BYTES = 16 * 1024 * 1024

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read a JSON request body up to a byte cap; null when unparseable or oversized. */
async function readJsonBody(req: IncomingMessage, cap: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    chunks.push(buffer)
    total += buffer.length
    if (total > cap) return null
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Write one JSON envelope response. */
function json(res: ServerResponse, envelope: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * Serve one stored image by its bare attachment id (the GET half of the prefix
 * route). Unknown ids and store failures answer 404; the media type comes
 * from the registered reference, never from the URL.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param req - the incoming GET request.
 * @param res - the outgoing response.
 */
async function serveRawImage(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const match = new RegExp(`^${ROUTE_PREFIX}/raw/([^/]+)$`).exec(new URL(req.url ?? '/', 'http://x').pathname)
  if (match === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const id = decodeURIComponent(match[1])
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    // The reference is content-addressed: resolve the stored bytes by id, and
    // the media type comes from the store, never from the URL.
    const stored = await attachments.readImage({ attachmentId: id as ImageAttachmentRef['attachmentId'] } as ImageAttachmentRef)
    res.writeHead(200, { 'content-type': stored.ref.mediaType, 'content-length': String(stored.data.byteLength), 'cache-control': 'private, max-age=3600' })
    res.end(Buffer.from(stored.data))
  } catch {
    res.writeHead(404)
    res.end()
  }
}

/** Loopback socket addresses the web shell serves on. */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Whether one request's socket is loopback. */
function isLoopbackSocket(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  return address !== undefined && LOOPBACK_ADDRESSES.has(address)
}

/** Loopback Host names (what a browser on this machine sends). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Whether the request Host names a loopback authority. */
function isLoopbackHost(req: IncomingMessage): boolean {
  const host = req.headers['host']
  if (typeof host !== 'string' || host.length === 0) return false
  try {
    // new URL handles bracketed IPv6 hosts and port stripping correctly.
    const name = new URL(`http://${host}`).hostname
    return LOOPBACK_HOSTS.has(name)
  } catch {
    return false
  }
}

/** Whether a browser origin is same-origin with the request authority (if any). */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers['origin']
  if (origin === undefined) return true // Non-browser client (no Origin header).
  if (typeof origin !== 'string' || origin.length === 0) return false
  const host = req.headers['host']
  if (typeof host !== 'string' || host.length === 0) return false
  try {
    // The public request object carries no trustworthy scheme; the local web
    // server speaks HTTP, so the Host header is parsed with the http: scheme
    // for its authority (hostname + port). new URL handles bracketed IPv6 and
    // never splits on ':'.
    const originUrl = new URL(origin)
    const hostUrl = new URL(`http://${host}`)
    // Hostname AND effective port must match: `localhost:3000` page vs
    // `localhost:3000` Host is one origin; a different port is another.
    return originUrl.hostname === hostUrl.hostname && effectivePortOf(originUrl) === effectivePortOf(hostUrl)
  } catch {
    return false
  }
}

/** The effective port of a parsed authority (default-port-aware, URL semantics). */
function effectivePortOf(url: URL): number {
  if (url.port !== '') return Number(url.port)
  // A portless authority means the scheme default: http 80, https 443.
  if (url.protocol === 'https:') return 443
  return 80
}

/**
 * The local trust fence for secret-bearing RPC (`/test`, `/models`, config
 * POST): the request must arrive on a loopback socket, name a loopback Host,
 * and carry no cross-origin browser marker. CORS alone is not a
 * local-privileged-API boundary — a malicious page must not be able to POST a
 * draft key into a probe. Non-loopback (remote) deployments refuse these
 * routes, matching the official settings seam's own remote restrictions.
 */
export function isTrustedLocalRequest(req: IncomingMessage): boolean {
  return isLoopbackSocket(req) && isLoopbackHost(req) && isSameOrigin(req)
}

/**
 * Register the /image-mind prefix route on the shared webserver: POST
 * /image-mind/attach uploads, GET /image-mind/raw/<id> serves stored bytes,
 * and POST /image-mind/test + /image-mind/models are thin vision RPC for the
 * settings card. The legacy GET/POST /image-mind/config routes remain as a
 * compatibility transport.
 * @param ctx - registrant context; webServer is optional and probed per call.
 * @param hooks - per-request hooks the plugin entry supplies.
 */
export function registerAttachRoute(
  ctx: Context,
  hooks: {
    readMaxBytes: () => number
    readConfigView: () => Promise<unknown>
    writeConfigView: (body: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>
    runConnectionTest: (body: unknown) => Promise<{ ok: boolean; value?: { text: string }; error?: { code: string; message: string } }>
    listEndpointModels: (body: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>
    catalog: () => unknown
  },
): void {
  const webserver = ctx.get('webServer')
  if (webserver === undefined) return
  webserver.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      // Legacy config gateway — compatibility transport only.
      if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/config`) {
        const view = await hooks.readConfigView()
        if (view === undefined) {
          json(res, { ok: false, error: { code: 'internal', message: 'image-mind settings section is not registered' } }, 500)
          return
        }
        json(res, { ok: true, value: view })
        return
      }
      if (req.method === 'POST' && pathname === `${ROUTE_PREFIX}/config`) {
        if (!isTrustedLocalRequest(req)) {
          json(res, { ok: false, error: { code: 'rejected', message: 'untrusted origin' } }, 403)
          return
        }
        const body = await readJsonBody(req, 64 * 1024)
        if (body === null) {
          json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON' } }, 400)
          return
        }
        const outcome = await hooks.writeConfigView(body)
        if (outcome.ok) {
          json(res, { ok: true, value: outcome.value })
          return
        }
        json(res, { ok: false, error: outcome.error }, outcome.error?.code === 'rejected' ? 422 : 500)
        return
      }
      // Thin vision RPC: one real vision call to verify the deployment.
      if (req.method === 'POST' && pathname === `${ROUTE_PREFIX}/test`) {
        if (!isTrustedLocalRequest(req)) {
          json(res, { ok: false, error: { code: 'rejected', message: 'untrusted origin' } }, 403)
          return
        }
        const body = await readJsonBody(req, 64 * 1024)
        if (body === null) {
          json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON' } }, 400)
          return
        }
        const outcome = await hooks.runConnectionTest(body ?? {})
        if (outcome.ok) {
          json(res, { ok: true, value: outcome.value })
          return
        }
        json(res, { ok: false, error: outcome.error }, outcome.error?.code === 'rejected' ? 422 : 500)
        return
      }
      // Thin vision RPC: list model ids for the current endpoint.
      if (req.method === 'POST' && pathname === `${ROUTE_PREFIX}/models`) {
        if (!isTrustedLocalRequest(req)) {
          json(res, { ok: false, error: { code: 'rejected', message: 'untrusted origin' } }, 403)
          return
        }
        const body = await readJsonBody(req, 64 * 1024)
        if (body === null) {
          json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON' } }, 400)
          return
        }
        const outcome = await hooks.listEndpointModels(body ?? {})
        if (outcome.ok) {
          json(res, { ok: true, value: outcome.value })
          return
        }
        json(res, { ok: false, error: outcome.error }, outcome.error?.code === 'rejected' ? 422 : 500)
        return
      }
      // The official-provider directory the "添加提供方" flow offers.
      if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/catalog`) {
        json(res, { ok: true, value: { catalog: hooks.catalog() } })
        return
      }
      // GET /image-mind/raw/<id>: serve the stored bytes so the markdown
      // image reference inserted into the send renders.
      if (req.method === 'GET') {
        await serveRawImage(ctx, req, res)
        return
      }
      if (req.method !== 'POST') {
        json(res, { ok: false, error: { code: 'internal', message: 'only GET and POST are allowed' } }, 405)
        return
      }
      const body = await readJsonBody(req, MAX_ATTACH_BODY_BYTES)
      if (body === null) {
        json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON within 16 MiB' } }, 400)
        return
      }
      const outcome = await handleAttach(ctx, hooks.readMaxBytes(), body)
      if (outcome.ok) {
        json(res, { ok: true, value: { note: outcome.note, markdown: outcome.markdown, ref: outcome.ref } })
        return
      }
      json(res, { ok: false, error: outcome.error }, outcome.error.code === 'rejected' ? 422 : 500)
    },
  })
}

export { decodeBase64, isImageMimeType, sniffMimeType }
export type { ImageMimeType }
