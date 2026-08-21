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

function request(url: string, remoteAddress = '127.0.0.1'): IncomingMessage {
  return {
    method: 'GET',
    url,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress },
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

describe('restart-safe committed preview routes', () => {
  it('cold-loads opaque batch history without returning attachment ids', async () => {
    const attachmentRoot = await mkdtemp(join(tmpdir(), 'image-mind-preview-restart-'))
    roots.push(attachmentRoot)
    await mkdir(join(attachmentRoot, '.image-mind'), { recursive: true })

    const id = `sha256:${'9'.repeat(64)}`
    const ref: ImageAttachmentRef = {
      attachmentId: id as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: 4,
      width: 1,
      height: 1,
      name: 'history.png',
    }
    await writeFile(
      join(attachmentRoot, '.image-mind', 'attachment-index-v1.json'),
      JSON.stringify({
        version: 1,
        refs: { [id]: ref },
        sessions: {
          'session-history': {
            batchId: 'batch-history',
            count: 1,
            refs: { '0': id },
            updatedAt: 2000,
            history: [{
              batchId: 'batch-history',
              count: 1,
              refs: { '0': id },
              updatedAt: 1500,
            }],
          },
        },
      }),
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
        if (key === 'webServer') return { register(value: unknown) { route = value as typeof route } }
        return undefined
      },
    } as unknown as Context

    registerAttachRoute(ctx, hooks)

    const listCapture = responseCapture()
    await route!.handler(request('/image-mind/previews?sessionId=session-history'), listCapture.res)
    expect(listCapture.result().status).toBe(200)
    const text = listCapture.result().body.toString('utf8')
    expect(JSON.parse(text)).toEqual({
      ok: true,
      value: { batches: [{ batchId: 'batch-history', count: 1, updatedAt: 1500 }] },
    })
    expect(text).not.toContain('sha256:')
    expect(text).not.toContain('attachmentId')
    expect(text).not.toContain('/image-mind/raw/')

    const imageCapture = responseCapture()
    await route!.handler(request('/image-mind/preview/batch-history/0'), imageCapture.res)
    expect(imageCapture.result()).toEqual({
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '4',
        'cache-control': 'private, max-age=3600',
      },
      body: Buffer.from([1, 2, 3, 4]),
    })
    expect(readImage).toHaveBeenCalledWith(ref)
  })

  it('rejects preview metadata from a non-loopback requester', async () => {
    const attachmentRoot = await mkdtemp(join(tmpdir(), 'image-mind-preview-trust-'))
    roots.push(attachmentRoot)
    let route: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } | undefined
    const ctx = {
      get(key: string) {
        if (key === 'attachments') return { root: attachmentRoot, readImage: vi.fn() }
        if (key === 'webServer') return { register(value: unknown) { route = value as typeof route } }
        return undefined
      },
    } as unknown as Context
    registerAttachRoute(ctx, hooks)

    const capture = responseCapture()
    await route!.handler(request('/image-mind/previews?sessionId=session-history', '10.0.0.8'), capture.res)
    expect(capture.result().status).toBe(403)
  })
})
