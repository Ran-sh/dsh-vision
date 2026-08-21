/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { registerAttachRoute } from '../src/attachments/routes.ts'

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

function remoteRequest(method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '203.0.113.20' },
  } as unknown as IncomingMessage
}

function routeFor(readConfigView = vi.fn(async () => ({ providers: {} }))) {
  let route: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } | undefined
  const ctx = {
    get(key: string) {
      if (key === 'webServer') return { register(value: unknown) { route = value as typeof route } }
      return undefined
    },
  } as unknown as Context
  registerAttachRoute(ctx, {
    readMaxBytes: () => 1024,
    readConfigView,
    writeConfigView: async () => ({ ok: true }),
    runConnectionTest: async () => ({
      ok: true as const,
      text: 'ok', provider: 'p', model: 'm', latencyMs: 1, visualVerified: true as const,
    }),
    listEndpointModels: async () => ({ ok: true as const, models: ['m'], source: 'endpoint' as const }),
    catalog: () => [],
  })
  return { route: route!, readConfigView }
}

describe('image-mind host route local trust fence', () => {
  it('rejects remote config reads before exposing the redacted provider view', async () => {
    const { route, readConfigView } = routeFor()
    const capture = responseCapture()

    await route.handler(remoteRequest('GET', '/image-mind/config'), capture.res)

    expect(capture.status()).toBe(403)
    expect(readConfigView).not.toHaveBeenCalled()
  })

  it('rejects remote attachment uploads before reading or storing the request body', async () => {
    const { route } = routeFor()
    const capture = responseCapture()

    await route.handler(remoteRequest('POST', '/image-mind/attach'), capture.res)

    expect(capture.status()).toBe(403)
  })
})
