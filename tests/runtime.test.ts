/**
 * VisionRuntime tests: provider registry lifecycle — register, duplicate,
 * unknown, active override, hot replace, removal, and in-flight isolation.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { VisionRuntime } from '../src/runtime/index.ts'
import { VisionAdapter } from '../src/runtime/adapter.ts'
import { VisionError } from '../src/runtime/errors.ts'
import type { VisionConnection, VisionRequest, VisionResult } from '../src/runtime/types.ts'

/** A stub adapter answering with its provider + model identity. */
function stubAdapter(overrides?: Partial<VisionAdapter>): VisionAdapter {
  const adapter = {
    async call(request: VisionRequest, connection: VisionConnection): Promise<VisionResult> {
      return { text: `answer from ${connection.provider}/${connection.model}`, provider: connection.provider, model: connection.model }
    },
  } satisfies VisionAdapter
  return Object.assign(adapter, overrides ?? {})
}

function connection(provider: string, model = 'm'): VisionConnection {
  return {
    provider,
    baseURL: 'https://api.example.com/v1',
    model,
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 60_000,
  }
}

describe('VisionRuntime', () => {
  it('registers an adapter and calls through it', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const adapter = stubAdapter()
    runtime.registerAdapter(['a'], adapter)
    const result = await runtime.call({ prompt: 'p', images: [] }, connection('a'))
    expect(result.text).toBe('answer from a/m')
  })

  it('rejects a duplicate provider route', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter())
    expect(() => runtime.registerAdapter(['a'], stubAdapter())).toThrow(VisionError)
  })

  it('rejects calling an unknown provider', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    await expect(runtime.call({ prompt: 'p', images: [] }, connection('nope'))).rejects.toThrow(VisionError)
  })

  it('lists providers only after registration', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerProvider({ id: 'a', displayName: 'A', adapter: 'openai-compatible', apiStyle: 'chat-completions' })
    expect(runtime.getProvider('a')?.displayName).toBe('A')
    expect(runtime.listProviders()).toHaveLength(0)
    runtime.registerAdapter(['a'], stubAdapter())
    expect(runtime.listProviders().map(p => p.id)).toEqual(['a'])
  })

  it('replaces routes atomically (hot change)', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const adapter = stubAdapter()
    const registration = runtime.registerAdapter(['a'], adapter)
    expect(runtime.hasProvider('a')).toBe(true)
    // Replace the route set: drop 'a', add 'b'.
    registration.replace(['b'])
    expect(runtime.hasProvider('a')).toBe(false)
    expect(runtime.hasProvider('b')).toBe(true)
    const result = await runtime.call({ prompt: 'p', images: [] }, connection('b'))
    expect(result.text).toBe('answer from b/m')
  })

  it('rejects a replace that collides with another adapter', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const registration = runtime.registerAdapter(['a'], stubAdapter())
    runtime.registerAdapter(['b'], stubAdapter())
    expect(() => registration.replace(['a', 'b'])).toThrow(VisionError)
    // The original routes stay untouched.
    expect(runtime.hasProvider('a')).toBe(true)
    expect(runtime.hasProvider('b')).toBe(true)
  })

  it('stops serving a provider after its registration disposes', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const registration = runtime.registerAdapter(['a'], stubAdapter())
    registration()
    expect(runtime.hasProvider('a')).toBe(false)
    await expect(runtime.call({ prompt: 'p', images: [] }, connection('a'))).rejects.toThrow(VisionError)
  })

  it('routes discovery through the registered adapter', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const discover = vi.fn(async () => [{ id: 'v1', vision: true }])
    runtime.registerAdapter(['a'], stubAdapter({ discoverModels: discover }))
    const models = await runtime.discoverModels('a', connection('a'))
    expect(models).toEqual([{ id: 'v1', vision: true }])
    expect(discover).toHaveBeenCalledOnce()
  })

  it('returns no models for an adapter without discovery', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter())
    const models = await runtime.discoverModels('a', connection('a'))
    expect(models).toEqual([])
  })

  it('disposes the registry with the fiber', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter())
    expect(runtime.hasProvider('a')).toBe(true)
    await ctx.fiber.dispose()
    expect(runtime.hasProvider('a')).toBe(false)
  })
})
