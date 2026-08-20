/** @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { registerAttachRoute } from '../src/attachments/routes.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function request(url: string): IncomingMessage {
  return {
    method: 'GET',
    url,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage
}

function responseCapture(): {
  res: ServerResponse
  result(): { status: number; headers: Record<string, string>; body: Buffer }
} {
  let status = 0
  let headers: Record<string, string> = {}
  let body = Buffer.alloc(0)
  return {
    res: {
      writeHead(code: number, next?: Record<string, string>) {
        status = code
        headers = next ?? {}
      },
      end(value?: string | Buffer) {
        body = value === undefined ? Buffer.alloc(0) : Buffer.isBuffer(value) ? value : Buffer.from(value)
      },
    } as unknown as ServerResponse,
    result: () => ({ status, headers, body }),
  }
}

const hooks = {
  readMaxBytes: () => 1024,
  readConfigView: async () => ({}),
  writeConfigView: async () => ({ ok: true }),
  runConnectionTest: async () => ({
    ok: true as const,
    text: 'ok', provider: 'p', model: 'm', latencyMs: 1, visualVerified: true as const,
  }),
  listEndpointModels: async () => ({ ok: true as const, models: ['m'], source: 'endpoint' as const }),
  catalog: () => [],
}

describe('restart-safe /image-mind/raw route', () => {
  it('cold-loads the complete reference from the durable index before reading bytes', async () => {
    const attachmentRoot = await mkdtemp(join(tmpdir(), 'image-mind-raw-restart-'))
    roots.push(attachmentRoot)
    await mkdir(join(attachmentRoot, '.image-mind'), { recursive: true })

    const id = `sha256:${'a'.repeat(64)}`
    const ref: ImageAttachmentRef = {
      attachmentId: id as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: 4,
      width: 1,
      height: 1,
      name: 'pixel.png',
    }
    await writeFile(
      join(attachmentRoot, '.image-mind', 'attachment-index-v1.json'),
      JSON.stringify({ version: 1, refs: { [id]: ref }, sessions: {} }),
      'utf8',
    )

    const readImage = vi.fn(async (received: ImageAttachmentRef) => ({
      ref: received,
      data: Uint8Array.from([1, 2, 3, 4]),
    }))
    let route: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } | undefined
    const ctx = {
      get(key: string) {
        if (key === 'attachments') return { root: attachmentRoot, readImage }
        if (key === 'webServer') {
          return {
            register(value: unknown) {
              route = value as typeof route
            },
          }
        }
        return undefined
      },
    } as unknown as Context

    registerAttachRoute(ctx, hooks)
    expect(route).toBeDefined()
    const capture = responseCapture()
    await route!.handler(request(`/image-mind/raw/${id}`), capture.res)

    expect(capture.result()).toEqual({
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '4',
        'cache-control': 'private, max-age=3600',
      },
      body: Buffer.from([1, 2, 3, 4]),
    })
    expect(readImage).toHaveBeenCalledOnce()
    expect(readImage).toHaveBeenCalledWith(ref)
  })

  it('returns 404 when the durable index has no complete reference for the id', async () => {
    const attachmentRoot = await mkdtemp(join(tmpdir(), 'image-mind-raw-miss-'))
    roots.push(attachmentRoot)
    const readImage = vi.fn()
    let route: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } | undefined
    const ctx = {
      get(key: string) {
        if (key === 'attachments') return { root: attachmentRoot, readImage }
        if (key === 'webServer') return { register(value: unknown) { route = value as typeof route } }
        return undefined
      },
    } as unknown as Context

    registerAttachRoute(ctx, hooks)
    const capture = responseCapture()
    await route!.handler(request(`/image-mind/raw/sha256:${'b'.repeat(64)}`), capture.res)

    expect(capture.result().status).toBe(404)
    expect(readImage).not.toHaveBeenCalled()
  })
})
