/**
 * VisionRuntime tests: provider registry lifecycle —register, duplicate,
 * unknown, active override, hot replace, replace([]), removal, disposed
 * rejection, directory dynamic add/remove, default-provider strategy
 * lifecycle (register / use / dispose / conflict), and multi-adapter
 * dispatch by provider route.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { VisionRuntime } from '../src/index.ts'
import { VisionAdapter } from '../src/adapter.ts'
import { VisionError } from '../src/errors.ts'
import type { VisionRequest, VisionResult } from '../src/types.ts'

/** A stub adapter answering with its provider + model identity. */
function stubAdapter(overrides?: Partial<VisionAdapter>): VisionAdapter {
  const adapter = {
    async call(provider: string, request: VisionRequest): Promise<VisionResult> {
      return { text: `answer from ${provider}/${request.model ?? 'm'}`, provider, model: request.model ?? 'm' }
    },
  } satisfies VisionAdapter
  return Object.assign(adapter, overrides ?? {})
}

describe('VisionRuntime', () => {
  it('registers an adapter and calls through it', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter())
    const result = await runtime.call({ prompt: 'p', images: [] })
    expect(result.text).toBe('answer from a/m')
    expect(result.provider).toBe('a')
  })

  it('rejects a duplicate adapter route with DUPLICATE_ADAPTER', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter())
    expect(() => runtime.registerAdapter(['a'], stubAdapter())).toThrow(VisionError)
    try {
      runtime.registerAdapter(['a'], stubAdapter())
    } catch (error) {
      expect((error as VisionError).code).toBe('DUPLICATE_ADAPTER')
    }
  })

  it('rejects an empty adapter route list with INVALID_ADAPTER', () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    expect(() => runtime.registerAdapter([], stubAdapter())).toThrow(VisionError)
    try {
      runtime.registerAdapter([], stubAdapter())
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
    runtime.registerProvider({ id: 'a', displayName: 'A' })
    expect(runtime.getProvider('a')?.displayName).toBe('A')
    expect(runtime.listProviders()).toHaveLength(0)
    runtime.registerAdapter(['a'], stubAdapter())
    expect(runtime.listProviders().map(p => p.id)).toEqual(['a'])
  })

  it('replaces routes atomically (hot change)', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const registration = runtime.registerAdapter(['a'], stubAdapter())
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
    const registration = runtime.registerAdapter(['a', 'b'], stubAdapter())
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
    const registration = runtime.registerAdapter(['a'], stubAdapter())
    runtime.registerAdapter(['b'], stubAdapter())
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
    const registration = runtime.registerAdapter(['a'], stubAdapter())
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
    const registration = runtime.registerAdapter(['a'], stubAdapter())
    registration()
    expect(runtime.hasProvider('a')).toBe(false)
    await expect(runtime.call({ provider: 'a', prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
  })

  it('disposes the registry with the fiber', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter())
    expect(runtime.hasProvider('a')).toBe(true)
    await ctx.fiber.dispose()
    expect(runtime.hasProvider('a')).toBe(false)
  })

  it('routes discovery through the registered adapter', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const discover = vi.fn(async () => [{ id: 'v1', vision: true }])
    runtime.registerAdapter(['a'], stubAdapter({ discoverModels: discover }))
    const models = await runtime.discoverModels({ provider: 'a' })
    expect(models).toEqual([{ id: 'v1', vision: true }])
    expect(discover).toHaveBeenCalledOnce()
  })

  it('returns no models for an adapter without discovery', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], stubAdapter())
    const models = await runtime.discoverModels({ provider: 'a' })
    expect(models).toEqual([])
  })

  it('rejects discovery for an unknown provider with PROVIDER_NOT_FOUND', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    await expect(runtime.discoverModels({ provider: 'nope' })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
  })

  it('publishes vision/adapters-updated on registration and replace', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const seen: string[] = []
    ctx.on('vision/adapters-updated', () => { seen.push('event') })
    const registration = runtime.registerAdapter(['a'], stubAdapter())
    registration.replace(['b'])
    registration()
    expect(seen.length).toBeGreaterThanOrEqual(3)
  })

  it('a broken adapters-updated listener does not veto the commit', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    ctx.on('vision/adapters-updated', () => { throw new Error('listener boom') })
    const registration = runtime.registerAdapter(['a'], stubAdapter())
    expect(runtime.hasProvider('a')).toBe(true)
    registration.replace(['b'])
    expect(runtime.hasProvider('b')).toBe(true)
  })

  describe('provider directory lifecycle', () => {
    it('registerConfigurableProviders owns entries and replaces atomically', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const handle = runtime.registerConfigurableProviders([
        { id: 'a', displayName: 'A' },
        { id: 'b', displayName: 'B' },
      ])
      expect(runtime.getProvider('a')).toBeDefined()
      expect(runtime.getProvider('b')).toBeDefined()
      handle.replace([{ id: 'c', displayName: 'C' }])
      expect(runtime.getProvider('a')).toBeUndefined()
      expect(runtime.getProvider('c')).toBeDefined()
    })

    it('duplicate directory entry rejects with DUPLICATE_PROVIDER', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      runtime.registerConfigurableProviders([{ id: 'a', displayName: 'A' }])
      expect(() => runtime.registerProvider({ id: 'a', displayName: 'A2' })).toThrow(VisionError)
    })

    it('directory entries disappear when the registration disposes', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const handle = runtime.registerConfigurableProviders([{ id: 'a', displayName: 'A' }])
      expect(runtime.getProvider('a')).toBeDefined()
      handle()
      expect(runtime.getProvider('a')).toBeUndefined()
    })

    it('replace([]) empties the directory entry set', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const handle = runtime.registerConfigurableProviders([{ id: 'a', displayName: 'A' }])
      handle.replace([])
      expect(runtime.getProvider('a')).toBeUndefined()
      expect(runtime.listDirectory()).toHaveLength(0)
    })

    it('a disposed directory registration rejects replace', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const handle = runtime.registerConfigurableProviders([{ id: 'a', displayName: 'A' }])
      handle()
      expect(() => handle.replace([{ id: 'b', displayName: 'B' }])).toThrow(VisionError)
      try {
        handle.replace([{ id: 'b', displayName: 'B' }])
      } catch (error) {
        expect((error as VisionError).code).toBe('REGISTRATION_DISPOSED')
      }
    })
  })

  describe('default-provider strategy (registerDefaultProviderResolver)', () => {
    /** A runtime with two routes and a mutable active seam. */
    function runtimeWithActive(initialActive: string): { runtime: VisionRuntime; setActive: (id: string) => void } {
      const ctx = new Context()
      let active = initialActive
      const runtime = new VisionRuntime(ctx)
      runtime.registerDefaultProviderResolver('owner-a', () => active)
      runtime.registerAdapter(['a', 'b'], stubAdapter())
      return {
        runtime,
        setActive: (id: string) => { active = id },
      }
    }

    it('routes = [a,b], active = a → omitted provider uses a', async () => {
      const { runtime } = runtimeWithActive('a')
      const result = await runtime.call({ prompt: 'p', images: [] })
      expect(result.provider).toBe('a')
    })

    it('active dynamically changes a → b → the next call uses b', async () => {
      const { runtime, setActive } = runtimeWithActive('a')
      const first = await runtime.call({ prompt: 'p', images: [] })
      expect(first.provider).toBe('a')
      setActive('b')
      const second = await runtime.call({ prompt: 'p', images: [] })
      expect(second.provider).toBe('b')
    })

    it('an explicit provider always wins over the active', async () => {
      const { runtime } = runtimeWithActive('a')
      const result = await runtime.call({ provider: 'b', prompt: 'p', images: [] })
      expect(result.provider).toBe('b')
    })

    it('active pointing at a route with no live adapter → PROVIDER_NOT_FOUND', async () => {
      const { runtime, setActive } = runtimeWithActive('a')
      setActive('gone')
      await expect(runtime.call({ prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
    })

    it('a second owner is refused with DUPLICATE_DEFAULT_PROVIDER (never silent override)', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      runtime.registerDefaultProviderResolver('owner-a', () => 'a')
      expect(() => runtime.registerDefaultProviderResolver('owner-b', () => 'b')).toThrow(VisionError)
      try {
        runtime.registerDefaultProviderResolver('owner-b', () => 'b')
      } catch (error) {
        expect((error as VisionError).code).toBe('DUPLICATE_DEFAULT_PROVIDER')
      }
    })

    it('the same owner re-registering replaces its own strategy', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      runtime.registerAdapter(['a', 'b'], stubAdapter())
      runtime.registerDefaultProviderResolver('owner-a', () => 'a')
      runtime.registerDefaultProviderResolver('owner-a', () => 'b')
      const result = await runtime.call({ prompt: 'p', images: [] })
      expect(result.provider).toBe('b')
    })

    it('disposing the strategy withdraws it (no stale resolver)', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      runtime.registerAdapter(['a', 'b'], stubAdapter())
      const dispose = runtime.registerDefaultProviderResolver('owner-a', () => 'a')
      dispose()
      await expect(runtime.call({ prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
    })

    it('fiber teardown withdraws the strategy (provider unload leaves no stale resolver)', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      runtime.registerAdapter(['a', 'b'], stubAdapter())
      runtime.registerDefaultProviderResolver('owner-a', () => 'a')
      await ctx.fiber.dispose()
      await expect(runtime.call({ prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
    })

    it('a re-registering owner may take over after its own fiber disposed the old strategy', () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      runtime.registerDefaultProviderResolver('owner-a', () => 'a')
      runtime.registerDefaultProviderResolver('owner-a', () => 'b')
      expect(() => runtime.registerDefaultProviderResolver('owner-b', () => 'c')).toThrow(VisionError)
    })
  })

  describe('multi-adapter dispatch by provider route', () => {
    it('provider A → adapter A, provider B → adapter B, never a guess', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const adapterAlpha = {
        async call(provider: string): Promise<VisionResult> {
          return { text: `alpha:${provider}`, provider, model: 'm' }
        },
      } satisfies VisionAdapter
      const adapterBeta = {
        async call(provider: string): Promise<VisionResult> {
          return { text: `beta:${provider}`, provider, model: 'm' }
        },
      } satisfies VisionAdapter
      runtime.registerAdapter(['a'], adapterAlpha)
      runtime.registerAdapter(['b'], adapterBeta)
      const viaA = await runtime.call({ provider: 'a', prompt: 'p', images: [] })
      const viaB = await runtime.call({ provider: 'b', prompt: 'p', images: [] })
      expect(viaA.text).toBe('alpha:a')
      expect(viaB.text).toBe('beta:b')
      // With no default and multiple live routes the runtime refuses rather
      // than guessing across adapter families.
      await expect(runtime.call({ prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
    })

    it('discovery dispatches by provider route to the owning adapter', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const discoverA = vi.fn(async () => [{ id: 'a-model' }])
      const discoverB = vi.fn(async () => [{ id: 'b-model' }])
      runtime.registerAdapter(['a'], stubAdapter({ discoverModels: discoverA }))
      runtime.registerAdapter(['b'], stubAdapter({ discoverModels: discoverB }))
      const modelsB = await runtime.discoverModels({ provider: 'b' })
      expect(modelsB).toEqual([{ id: 'b-model' }])
      expect(discoverB).toHaveBeenCalledOnce()
      expect(discoverA).not.toHaveBeenCalled()
    })

    it('probe dispatches by provider route to the owning adapter', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      const probeA = vi.fn(async () => ({ text: 'probed a', provider: 'a', model: 'm' }))
      const probeB = vi.fn(async () => ({ text: 'probed b', provider: 'b', model: 'm' }))
      runtime.registerAdapter(['a'], stubAdapter({ probe: probeA }))
      runtime.registerAdapter(['b'], stubAdapter({ probe: probeB }))
      const result = await runtime.probe('a', { prompt: 'p', images: [] })
      expect(result.text).toBe('probed a')
      expect(probeA).toHaveBeenCalledOnce()
      expect(probeB).not.toHaveBeenCalled()
    })

    it('probe reports NO_ADAPTER when the route adapter has no probe path', async () => {
      const ctx = new Context()
      const runtime = new VisionRuntime(ctx)
      runtime.registerAdapter(['a'], stubAdapter())
      await expect(runtime.probe('a', { prompt: 'p', images: [] })).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    })
  })
})
