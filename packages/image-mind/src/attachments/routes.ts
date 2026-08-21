/**
 * The /image-mind host routes: upload + durable raw bytes, safe committed
 * conversation-preview lookup, and thin settings/connection RPC.
 * @module dsh-plugin-image-mind/attachments/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { decodeBase64, isImageMimeType, sniffMimeType, type ImageMimeType } from '../media/validate.ts'
import { handleAttach } from './routes-core.ts'
import {
  commitSessionAttachmentBatch,
  durableAttachmentRefById,
  previewAttachmentRef,
  sessionAttachmentPreviewBatches,
} from './ref-index.ts'
import { ROUTE_PREFIX } from './store.ts'

export { ROUTE_PREFIX }

/** Request-body byte cap: base64 of a 10 MiB image plus envelope slack. */
export const MAX_ATTACH_BODY_BYTES = 16 * 1024 * 1024

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

function json(res: ServerResponse, envelope: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

async function serveStoredImage(ctx: Context, ref: ImageAttachmentRef | undefined, res: ServerResponse): Promise<void> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined || ref === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
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

async function serveRawImage(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const match = new RegExp(`^${ROUTE_PREFIX}/raw/([^/]+)$`).exec(new URL(req.url ?? '/', 'http://x').pathname)
  if (match === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const id = decodeURIComponent(match[1])
  await serveStoredImage(ctx, await durableAttachmentRefById(ctx, id), res)
}

async function serveCommittedPreview(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const match = new RegExp(`^${ROUTE_PREFIX}/preview/([^/]+)/(\\d+)$`).exec(new URL(req.url ?? '/', 'http://x').pathname)
  if (match === null) return false
  if (!isTrustedLocalRequest(req)) {
    res.writeHead(403)
    res.end()
    return true
  }
  const batchId = decodeURIComponent(match[1])
  const batchIndex = Number(match[2])
  await serveStoredImage(ctx, await previewAttachmentRef(ctx, batchId, batchIndex), res)
  return true
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function isLoopbackSocket(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  return address !== undefined && LOOPBACK_ADDRESSES.has(address)
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

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

function effectivePortOf(url: URL): number {
  if (url.port !== '') return Number(url.port)
  if (url.protocol === 'https:') return 443
  return 80
}

/** Local trust fence for settings and preview metadata/bytes. */
export function isTrustedLocalRequest(req: IncomingMessage): boolean {
  return isLoopbackSocket(req) && isLoopbackHost(req) && isSameOrigin(req)
}

function previewCommitBody(value: unknown): { sessionId: string; batchId: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const sessionId = record['sessionId']
  const batchId = record['batchId']
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 256) return undefined
  if (typeof batchId !== 'string' || batchId.length === 0 || batchId.length > 128) return undefined
  return { sessionId, batchId }
}

/** Register all image-mind web routes on the shared DSH webserver. */
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
      const parsedUrl = new URL(req.url ?? '/', 'http://x')
      const pathname = parsedUrl.pathname

      if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/config`) {
        const view = await hooks.readConfigView()
        if (view === undefined) {
          json(res, { ok: false, error: { code: 'internal', message: 'image-mind settings section is not registered' } }, 500)
          return
        }
        json(res, { ok: true, value: view })
        return
      }

      if (req.method === 'GET' && pathname === `${ROUTE_PREFIX}/previews`) {
        if (!isTrustedLocalRequest(req)) {
          json(res, { ok: false, error: { code: 'rejected', message: 'untrusted origin' } }, 403)
          return
        }
        const sessionId = parsedUrl.searchParams.get('sessionId')
        if (sessionId === null || sessionId.length === 0 || sessionId.length > 256) {
          json(res, { ok: false, error: { code: 'rejected', message: 'sessionId is required' } }, 422)
          return
        }
        const batches = await sessionAttachmentPreviewBatches(ctx, sessionId)
        json(res, { ok: true, value: { batches } })
        return
      }

      if (req.method === 'GET' && await serveCommittedPreview(ctx, req, res)) return

      if (req.method === 'POST' && pathname === `${ROUTE_PREFIX}/preview/commit`) {
        if (!isTrustedLocalRequest(req)) {
          json(res, { ok: false, error: { code: 'rejected', message: 'untrusted origin' } }, 403)
          return
        }
        const body = previewCommitBody(await readJsonBody(req, 8 * 1024))
        if (body === undefined) {
          json(res, { ok: false, error: { code: 'rejected', message: 'sessionId and batchId are required' } }, 422)
          return
        }
        const committed = await commitSessionAttachmentBatch(ctx, body.sessionId, body.batchId)
        if (!committed) {
          json(res, { ok: false, error: { code: 'conflict', message: 'preview batch is incomplete or no longer latest' } }, 409)
          return
        }
        json(res, { ok: true, value: { committed: true } })
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
