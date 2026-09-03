/**
 * Focused regression coverage for the webServer service lifecycle seam
 * (src/runtime/webserver-lifecycle.ts, task RC1-WEBSERVER-LIFECYCLE-009):
 * /image-mind routes must land on the host webServer immediately when it
 * already exists, when it appears after image-mind applies, and again when
 * its implementation is replaced — while never registering twice on the same
 * server instance. No bounded timer may be involved anywhere.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { VisionRuntime } from '@ran-sh/dsh-vision'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { apply } from '../src/index.ts'
import { observeWebServerLifecycle } from '../src/runtime/webserver-lifecycle.ts'
import { VISION_PROVIDER_CATALOG } from '../src/providers/catalog.ts'

/** Drain the Cordis reload microtask chain so lifecycle callbacks land. */
const flush = async (): Promise<void> => {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

/** A recorded prefix-route registry standing in for the host webServer. */
function stubServer(id: string): { id: string } {
  return { id }
}

/** A plugin whose activation provides the given object as `webServer`. */
function providesWebServer(server: object): (ctx: Context) => void {
  return (ctx: Context) => { ctx.provide('webServer', server as never) }
}

describe('webServer service lifecycle seam', () => {
  it('attaches immediately when the webServer service already exists', async () => {
    const ctx = new Context()
    let attaches = 0
    await ctx.plugin(providesWebServer(stubServer('A')))
    observeWebServerLifecycle(ctx, () => { attaches += 1 })
    await flush()
    expect(attaches).toBe(1)
  })

  it('attaches when the webServer service first appears after observe', async () => {
    const ctx = new Context()
    let attaches = 0
    observeWebServerLifecycle(ctx, () => { attaches += 1 })
    await flush()
    expect(attaches).toBe(0)

    await ctx.plugin(providesWebServer(stubServer('A')))
    await flush()
    expect(attaches).toBe(1)
  })

  it('detaches then re-attaches when the same server instance restarts', async () => {
    const ctx = new Context()
    let attaches = 0
    let detaches = 0
    const serverA = stubServer('A')
    const first = await ctx.plugin(providesWebServer(serverA))
    observeWebServerLifecycle(ctx, () => {
      attaches += 1
      return () => { detaches += 1 }
    })
    await flush()
    expect(attaches).toBe(1)

    // The providing fiber restarts while handing back the SAME instance:
    // the old registration is disposed, then the new fiber attaches again.
    // Route ownership belongs to the fiber/disposer — not object identity —
    // so the sequence is attach → detach → attach.
    await first.dispose()
    await flush()
    expect(detaches).toBe(1)
    const second = await ctx.plugin(providesWebServer(serverA))
    await flush()
    expect(attaches).toBe(2)
    await second.dispose()
  })

  it('attaches again when the implementation is replaced by a new server', async () => {
    const ctx = new Context()
    let attaches = 0
    const first = await ctx.plugin(providesWebServer(stubServer('A')))
    observeWebServerLifecycle(ctx, () => { attaches += 1 })
    await flush()
    expect(attaches).toBe(1)

    await first.dispose()
    await flush()
    await ctx.plugin(providesWebServer(stubServer('B')))
    await flush()
    expect(attaches).toBe(2)
  })
})

/** Fake request for driving the captured prefix handler (catalog is open). */
function request(method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: { host: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () {},
  } as unknown as IncomingMessage
}

/** Capture what the handler writes to the response. */
function capture(): { res: ServerResponse; result: () => { status: number; payload: string } } {
  let status = 0
  let payload = ''
  const res = {
    writeHead(code: number) { status = code },
    end(text: string) { payload = text },
  } as unknown as ServerResponse
  return { res, result: () => ({ status, payload }) }
}

/** Mount image-mind against a real Context (vision + tool/credential stubs). */
async function mount(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(VisionRuntime)
  ctx.provide('tools', { register: () => () => {} } as never)
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'sk-test', source: 'test' }),
  } as never)
  apply(ctx, config as never)
  return ctx
}

type PrefixHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** A plugin providing a webServer stub that records registered handlers. */
function recordingWebServer(handlers: PrefixHandler[]): (ctx: Context) => void {
  return (ctx: Context) => {
    ctx.provide('webServer', {
      register(route: { handler: PrefixHandler }) {
        handlers.push(route.handler)
        return () => {}
      },
    } as never)
  }
}

describe('apply() route lifecycle (composition)', () => {
  it('serves GET /image-mind/catalog when the webServer exists before apply', async () => {
    const ctx = await mount({})
    const handlers: PrefixHandler[] = []
    await ctx.plugin(recordingWebServer(handlers))
    await flush()
    expect(handlers).toHaveLength(1)
    const { res, result } = capture()
    await handlers[0](request('GET', '/image-mind/catalog'), res)
    const out = result()
    expect(out.status).toBe(200)
    const body = JSON.parse(out.payload) as { ok: boolean; value: { catalog: Array<{ id: string }> } }
    expect(body.ok).toBe(true)
    expect(body.value.catalog.map(entry => entry.id)).toEqual(VISION_PROVIDER_CATALOG.map(entry => entry.id))
    await ctx.fiber.dispose()
  })

  it('serves GET /image-mind/catalog when the webServer appears after apply', async () => {
    const ctx = await mount({})
    const handlers: PrefixHandler[] = []
    await flush()
    await ctx.plugin(recordingWebServer(handlers))
    await flush()
    expect(handlers).toHaveLength(1)
    const { res, result } = capture()
    await handlers[0](request('GET', '/image-mind/catalog'), res)
    const out = result()
    expect(out.status).toBe(200)
    expect((JSON.parse(out.payload) as { ok: boolean }).ok).toBe(true)
    await ctx.fiber.dispose()
  })

  it('unregisters on dispose and re-registers across restart churn', async () => {
    const ctx = await mount({})
    let registrations = 0
    let unregistrations = 0
    let instance: object | undefined
    const provideOnce = (): (ctx: Context) => void => (provideCtx: Context) => {
      if (instance === undefined) {
        instance = {
          register(): () => void {
            registrations += 1
            return () => { unregistrations += 1 }
          },
        }
      }
      provideCtx.provide('webServer', instance as never)
    }
    const p1 = await ctx.plugin(provideOnce())
    await flush()
    expect(registrations).toBe(1)
    // Disposing the image-mind fiber unregisters its route, so re-providing
    // the same server instance through a restarted fiber must register again
    // (dispose → re-register), never leak a stale route.
    await p1.dispose()
    await flush()
    const p2 = await ctx.plugin(provideOnce())
    await flush()
    expect(registrations).toBe(2)
    await p2.dispose()
    await flush()
    expect(unregistrations).toBe(2)
    await ctx.fiber.dispose()
  })
})
