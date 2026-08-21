/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { registerAttachRoute } from '../src/attachments/routes.ts'

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

function responseCapture(): { res: ServerResponse; status: () => number } {
  let status = 0
  return {
    res: {
      writeHead(code: number) { status = code },
      end() {},
    } as unknown as ServerResponse,
    status: () => status,
  }
}

function routeFor(readImage = vi.fn()) {
  let route: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } | undefined
  const ctx = {
    get(key: string) {
      if (key === 'attachments') return { readImage }
      if (key === 'webServer') return { register(value: unknown) { route = value as typeof route } }
      return undefined
    },
  } as unknown as Context
  registerAttachRoute(ctx, hooks)
  return { route: route!, readImage }
}

function request(remoteAddress: string, origin?: string): IncomingMessage {
  return {
    method: 'GET',
    url: `/image-mind/raw/sha256:${'a'.repeat(64)}`,
    headers: {
      host: '127.0.0.1:3080',
      ...(origin === undefined ? {} : { origin }),
    },
    socket: { remoteAddress },
  } as unknown as IncomingMessage
}

describe('/image-mind/raw local trust boundary', () => {
  it('rejects a non-loopback client before attachment lookup', async () => {
    const { route, readImage } = routeFor()
    const capture = responseCapture()

    await route.handler(request('203.0.113.10'), capture.res)

    expect(capture.status()).toBe(403)
    expect(readImage).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin browser request even on loopback', async () => {
    const { route, readImage } = routeFor()
    const capture = responseCapture()

    await route.handler(request('127.0.0.1', 'http://evil.example:3080'), capture.res)

    expect(capture.status()).toBe(403)
    expect(readImage).not.toHaveBeenCalled()
  })
})
