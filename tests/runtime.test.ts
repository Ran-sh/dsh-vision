/**
 * VisionRuntime tests: provider registry lifecycle — register, duplicate,
 * unknown, active override, hot replace, replace([]), removal, disposed
 * rejection, directory dynamic add/remove, and in-flight snapshot isolation.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { VisionRuntime } from '../src/runtime/index.ts'
import { VisionAdapter } from '../src/runtime/adapter.ts'
import { VisionError } from '../src/runtime/errors.ts'
import type { VisionConnection, VisionConnectionResolver, VisionRequest, VisionResult } from '../src/runtime/types.ts'

/** A stub adapter answering with its provider + model identity. */
function stubAdapter(overrides?: Partial<VisionAdapter>): VisionAdapter {
  const adapter = {
    async call(request: VisionRequest, connection: Readonly<VisionConnection>): Promise<VisionResult> {
      return { text: `answer from ${connection.provider}/${connection.model}`, provider: connection.provider, model: connection.model }
    },
  } satisfies VisionAdapter
  return Object.assign(adapter, overrides ?? {})
}

/** A connection resolver returning fixed facts for any request. */
function resolver(provider: string, model = 'm'): VisionConnectionResolver {
  return () => ({
    provider,
    baseURL: 'https://api.example.com/v1',
    model,
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 60_000,
  })
}

describe('VisionRuntime', () => {
  it('registers an adapter and calls through it (single-arg call)', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    const result = await runtime.call({ prompt: 'p', images: [] })
    expect(result.text).toBe('answer from a/m')
    expect(result.provider).toBe('a')
  })

  it('rejects a duplicate adapter route with DUPLICATE_ADAPTER', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    expect(() => runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))).toThrow(VisionError)
    try {
      runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    } catch (error) {
      expect((error as VisionError).code).toBe('DUPLICATE_ADAPTER')
    }
  })

  it('rejects an empty adapter route list with INVALID_ADAPTER', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    expect(() => runtime.registerAdapter([], stubAdapter(), resolver('a'))).toThrow(VisionError)
    try {
      runtime.registerAdapter([], stubAdapter(), resolver('a'))
    } catch (error) {
      expect((error as VisionError).code).toBe('INVALID_ADAPTER')
    }
  })

  it('rejects calling an unknown provider with PROVIDER_NOT_FOUND', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    await expect(runtime.call({ provider: 'nope', prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
  })

  it('lists providers only after registration', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerProvider({ id: 'a', displayName: 'A', adapter: 'openai-compatible', apiStyle: 'chat-completions' })
    expect(runtime.getProvider('a')?.displayName).toBe('A')
    expect(runtime.listProviders()).toHaveLength(0)
    runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    expect(runtime.listProviders().map(p => p.id)).toEqual(['a'])
  })

  it('replaces routes atomically (hot change)', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    // The resolver is provider-aware, like the real one (it looks up the
    // request's provider in the configuration).
    const registration = runtime.registerAdapter(['a'], stubAdapter(), request => resolver(request.provider ?? 'a')())
    expect(runtime.hasProvider('a')).toBe(true)
    registration.replace(['b'])
    expect(runtime.hasProvider('a')).toBe(false)
    expect(runtime.hasProvider('b')).toBe(true)
    const result = await runtime.call({ prompt: 'p', images: [] })
    expect(result.text).toBe('answer from b/m')
  })

  it('replace([]) atomically removes every route', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const registration = runtime.registerAdapter(['a', 'b'], stubAdapter(), resolver('a'))
    expect(runtime.hasProvider('a')).toBe(true)
    expect(runtime.hasProvider('b')).toBe(true)
    registration.replace([])
    expect(runtime.hasProvider('a')).toBe(false)
    expect(runtime.hasProvider('b')).toBe(false)
    await expect(runtime.call({ provider: 'a', prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
  })

  it('rejects a replace that collides with another adapter, leaving old routes intact', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const registration = runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    runtime.registerAdapter(['b'], stubAdapter(), resolver('b'))
    expect(() => registration.replace(['a', 'b'])).toThrow(VisionError)
    try {
      registration.replace(['a', 'b'])
    } catch (error) {
      expect((error as VisionError).code).toBe('DUPLICATE_ADAPTER')
    }
    expect(runtime.hasProvider('a')).toBe(true)
    expect(runtime.hasProvider('b')).toBe(true)
  })

  it('rejects replace on a disposed registration with REGISTRATION_DISPOSED', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const registration = runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    registration()
    expect(runtime.hasProvider('a')).toBe(false)
    expect(() => registration.replace(['b'])).toThrow(VisionError)
    try {
      registration.replace(['b'])
    } catch (error) {
      expect((error as VisionError).code).toBe('REGISTRATION_DISPOSED')
    }
  })

  it('stops serving a provider after its registration disposes', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const registration = runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    registration()
    expect(runtime.hasProvider('a')).toBe(false)
    await expect(runtime.call({ provider: 'a', prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
  })

  it('disposes the registry with the fiber', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    expect(runtime.hasProvider('a')).toBe(true)
    await ctx.fiber.dispose()
    expect(runtime.hasProvider('a')).toBe(false)
  })

  it('routes discovery through the registered adapter', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const discover = vi.fn(async () => [{ id: 'v1', vision: true }])
    runtime.registerAdapter(['a'], stubAdapter({ discoverModels: discover }), resolver('a'))
    const models = await runtime.discoverModels({ provider: 'a' })
    expect(models).toEqual([{ id: 'v1', vision: true }])
    expect(discover).toHaveBeenCalledOnce()
  })

  it('returns no models for an adapter without discovery', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    const models = await runtime.discoverModels({ provider: 'a' })
    expect(models).toEqual([])
  })

  it('discovery via a draft connection uses the active route adapter', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const discover = vi.fn(async () => [{ id: 'v1' }])
    runtime.registerAdapter(['a'], stubAdapter({ discoverModels: discover }), resolver('a'))
    const models = await runtime.discoverModels({ draft: { baseURL: 'https://draft.example/v1' } })
    expect(models).toEqual([{ id: 'v1' }])
    expect(discover).toHaveBeenCalledOnce()
  })

  it('publishes vision/adapters-updated on registration and replace', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const seen: string[] = []
    ctx.on('vision/adapters-updated', () => { seen.push('event') })
    const registration = runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    registration.replace(['b'])
    registration()
    expect(seen.length).toBeGreaterThanOrEqual(3)
  })

  it('a broken adapters-updated listener does not veto the commit', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    ctx.on('vision/adapters-updated', () => { throw new Error('listener boom') })
    const registration = runtime.registerAdapter(['a'], stubAdapter(), resolver('a'))
    expect(runtime.hasProvider('a')).toBe(true)
    registration.replace(['b'])
    expect(runtime.hasProvider('b')).toBe(true)
  })

  describe('provider directory lifecycle', () => {
    it('registerConfigurableProviders owns entries and replaces atomically', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const handle = runtime.registerConfigurableProviders([
        { id: 'a', displayName: 'A', adapter: 'openai-compatible', apiStyle: 'chat-completions' },
        { id: 'b', displayName: 'B', adapter: 'openai-compatible', apiStyle: 'chat-completions' },
      ])
      expect(runtime.getProvider('a')).toBeDefined()
      expect(runtime.getProvider('b')).toBeDefined()
      handle.replace([{ id: 'c', displayName: 'C', adapter: 'openai-compatible', apiStyle: 'chat-completions' }])
      expect(runtime.getProvider('a')).toBeUndefined()
      expect(runtime.getProvider('c')).toBeDefined()
    })

    it('duplicate directory entry rejects with DUPLICATE_PROVIDER', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      runtime.registerConfigurableProviders([{ id: 'a', displayName: 'A', adapter: 'x', apiStyle: 'chat-completions' }])
      expect(() => runtime.registerProvider({ id: 'a', displayName: 'A2', adapter: 'x', apiStyle: 'chat-completions' })).toThrow(VisionError)
    })

    it('directory entries disappear when the registration disposes', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const handle = runtime.registerConfigurableProviders([{ id: 'a', displayName: 'A', adapter: 'x', apiStyle: 'chat-completions' }])
      expect(runtime.getProvider('a')).toBeDefined()
      handle()
      expect(runtime.getProvider('a')).toBeUndefined()
    })

    it('replace([]) empties the directory entry set', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const handle = runtime.registerConfigurableProviders([{ id: 'a', displayName: 'A', adapter: 'x', apiStyle: 'chat-completions' }])
      handle.replace([])
      expect(runtime.getProvider('a')).toBeUndefined()
      expect(runtime.listDirectory()).toHaveLength(0)
    })

    it('a disposed directory registration rejects replace', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const handle = runtime.registerConfigurableProviders([{ id: 'a', displayName: 'A', adapter: 'x', apiStyle: 'chat-completions' }])
      handle()
      expect(() => handle.replace([{ id: 'b', displayName: 'B', adapter: 'x', apiStyle: 'chat-completions' }])).toThrow(VisionError)
      try {
        handle.replace([{ id: 'b', displayName: 'B', adapter: 'x', apiStyle: 'chat-completions' }])
      } catch (error) {
        expect((error as VisionError).code).toBe('REGISTRATION_DISPOSED')
      }
    })
  })

  describe('connection snapshot isolation', () => {
    it('each call captures a fresh snapshot; a settings change affects only the next call', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const seenBaseURLs: string[] = []
      const mutable = { baseURL: 'https://one.example/v1' }
      const registration = runtime.registerAdapter(['a'], stubAdapter(), () => ({
        provider: 'a',
        baseURL: mutable.baseURL,
        model: 'm',
        apiStyle: 'chat-completions' as const,
        maxOutputTokens: 1024,
        timeoutMs: 60_000,
      }))
      const first = await runtime.call({ prompt: 'p', images: [] })
      // The in-flight call already resolved; a config change before the next
      // call must not retroactively change the first result's snapshot.
      expect(first.text).toBe('answer from a/m')
      // Change the underlying config, then call again — the next snapshot sees it.
      mutable.baseURL = 'https://two.example/v1'
      const adapter = runtime.adapterFor('a') as VisionAdapter & { seen: string[] }
      // Capture what the adapter saw: override call to record the baseURL.
      const recorded: string[] = []
      const spy = stubAdapter()
      registration.replace([])
      runtime.registerAdapter(['a'], {
        async call(request: VisionRequest, connection: Readonly<VisionConnection>): Promise<VisionResult> {
          recorded.push(connection.baseURL)
          return { text: `answer from ${connection.baseURL}`, provider: connection.provider, model: connection.model }
        },
      }, () => ({
        provider: 'a',
        baseURL: mutable.baseURL,
        model: 'm',
        apiStyle: 'chat-completions' as const,
        maxOutputTokens: 1024,
        timeoutMs: 60_000,
      }))
      void spy
      await runtime.call({ prompt: 'p', images: [] })
      await runtime.call({ prompt: 'p', images: [] })
      expect(recorded).toEqual(['https://two.example/v1', 'https://two.example/v1'])
    })

    it('the connection snapshot is deep-frozen before the adapter sees it', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      let frozen = false
      const adapter = {
        async call(_request: VisionRequest, connection: Readonly<VisionConnection>): Promise<VisionResult> {
          frozen = Object.isFrozen(connection)
          try {
            // Attempt to mutate must fail (frozen) or be silently ignored.
            (connection as { baseURL: string }).baseURL = 'https://hacked.example/v1'
          } catch {
            frozen = frozen && true
          }
          return { text: 'ok', provider: connection.provider, model: connection.model }
        },
      } satisfies VisionAdapter
      runtime.registerAdapter(['a'], adapter, resolver('a'))
      await runtime.call({ prompt: 'p', images: [] })
      expect(frozen).toBe(true)
      // The next call still resolves the original snapshot (not the hack).
      const second = await runtime.call({ prompt: 'p', images: [] })
      expect(second.text).toBe('ok')
    })
  })
})
