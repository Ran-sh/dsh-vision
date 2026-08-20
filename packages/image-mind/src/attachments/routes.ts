/**
 * The /image-mind host routes: a browser-to-host upload seam that turns a
 * picked image into a durable attachment reference, plus the raw route that
 * serves stored bytes, plus thin vision RPC for settings.
 * @module dsh-plugin-image-mind/attachments/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { decodeBase64, isImageMimeType, sniffMimeType, type ImageMimeType } from '../media/validate.ts'
import { DEFAULT_MAX_BYTES } from '../media/types.ts'
import { handleAttach } from './routes-core.ts'
import { durableAttachmentRefById } from './ref-index.ts'
import { ROUTE_PREFIX } from './store.ts'

export { ROUTE_PREFIX }

/** Request-body byte cap: base64 of a 10 MiB image plus envelope slack. */
export const MAX_ATTACH_BODY_BYTES = 16 * 1024 * 1024

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
 * Serve one stored image by its bare attachment id. DSH's durable attachment
 * backend validates a COMPLETE reference, not merely the sha256 id; resolve
 * that metadata through image-mind's bounded durable index first. This is the
 * restart-safe half of the attach seam.
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
    const ref = await durableAttachmentRefById(ctx, id)
    if (ref === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    const stored = await attachments.readImage(ref)
    res.writeHead(200, {
      'content-type': stored.ref.mediaType,
      'content-length': String(stored.data.byteLength),
      'cache-control': 'private, max-age=3600',
    })
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
    const name = new URL(`http://${host}`).hostname
    return LOOPBACK_HOSTS.has(name)
  } catch {
    return false
  }
}

/** Whether a browser origin is same-origin with the request authority (if any). */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers['origin']
  if (origin === undefined) return true
  if (typeof origin !== 'string' || origin.length === 0) return false
  const host = req.headers['host']
  if (typeof host !== 'string' || host.length === 0) return false
  try {
    const originUrl = new URL(origin)
    const hostUrl = new URL(`http://${host}`)
    return originUrl.hostname === hostUrl.hostname && effectivePortOf(originUrl) === effectivePortOf(hostUrl)
  } catch {
    return false
  }
}

/** The effective port of a parsed authority (default-port-aware). */
function effectivePortOf(url: URL): number {
  if (url.port !== '') return Number(url.port)
  if (url.protocol === 'https:') return 443
  return 80
}

/**
 * Local trust fence for secret-bearing RPC (`/test`, `/models`, config POST).
 */
export function isTrustedLocalRequest(req: IncomingMessage): boolean {
  return isLoopbackSocket(req) && isLoopbackHost(req) && isSameOrigin(req)
}

/**
 * Register the /image-mind prefix route on the shared webserver: POST
 * /image-mind/attach uploads, GET /image-mind/raw/<id> serves stored bytes,
 * and POST /image-mind/test + /image-mind/models are thin settings RPC.
 */
export function registerAttachRoute(
  ctx: Context,
  hooks: {
    readMaxBytes: () => number
    readConfigView: () => Promise<unknown>
    writeConfigView: (body: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>
    runConnectionTest: (body: unknown) => Promise<
      | { ok: true; text: string; provider: string; model: string; latencyMs: number; visualVerified: true }
      | { ok: false; message: string; visualFailed?: true }>
    listEndpointModels: (body: unknown) => Promise<
      | { ok: true; models: string[]; source: 'endpoint' | 'fallback'; reason?: string }
      | { ok: false; message: string }>
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
          json(res, { ok: true, value: { text: outcome.text, provider: outcome.provider, model: outcome.model, latencyMs: outcome.latencyMs, visualVerified: outcome.visualVerified } })
          return
        }
        json(res, { ok: false, error: { code: outcome.visualFailed === true ? 'visual' : 'failed', message: outcome.message } })
        return
      }
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
          json(res, { ok: true, value: { models: outcome.models, source: outcome.source, ...outcome.reason === undefined ? {} : { reason: outcome.reason } } })
          return
        }
        json(res, { ok: false, error: { code: 'failed', message: outcome.message } })
        return
      }
      if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/catalog`) {
        json(res, { ok: true, value: { catalog: hooks.catalog() } })
        return
      }
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
