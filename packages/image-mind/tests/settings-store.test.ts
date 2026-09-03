/**
 * Settings-store persistence tests: the keyless fact stays a strict boolean
 * through every edit path, displayName and keyless changes survive a
 * save + reload round trip (planOps must actually emit them for EXISTING
 * providers), and the dirty/no-op invariant holds — `dirty() === true` always
 * means a settings op or credential write exists, never a silent no-op save.
 * The official settings/credentials wire is stubbed with an in-memory fake.
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real store package is browser-bundled; the settings store only needs
// its snapshot primitive, which this fake implements faithfully.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: (initial: unknown) => {
    let snapshot = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => snapshot,
      set: (next: unknown) => {
        snapshot = next
        for (const listener of listeners) listener()
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
  },
}))

import type { ImageMindClientContext } from '../src/client/settings/transport.ts'
import { ImageMindSettingsStore } from '../src/client/settings/store.ts'
import { deriveKeyRef } from '../src/client/settings/identity.ts'

/** Apply one path op to a nested plain-object value. */
function applyOp(value: Record<string, unknown>, op: { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }): void {
  let node: Record<string, unknown> = value
  for (let i = 0; i < op.path.length - 1; i += 1) {
    const key = op.path[i]
    const next = node[key]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      const created: Record<string, unknown> = {}
      node[key] = created
      node = created
    } else {
      node = next as Record<string, unknown>
    }
  }
  const leaf = op.path[op.path.length - 1]
  if (op.op === 'set') node[leaf] = op.value
  else delete node[leaf]
}

/** An in-memory fake of the alpha settings scope + credentials faces. */
function fakeConnection(initial: Record<string, unknown>, opts: { startLoading?: boolean } = {}): {
  connection: ImageMindClientContext
  view: Record<string, unknown>
  /** Flip the mirror between `loading` and `ready` and notify subscribers. */
  setStatus: (status: 'loading' | 'ready') => void
  /** The in-memory credential store (configured refs). */
  credentialStore: Map<string, string>
  /** Make the next credential write fail (settings must stay untouched). */
  failNextCredentialSet: () => void
} {
  const view: Record<string, unknown> = JSON.parse(JSON.stringify(initial))
  const credentials = new Map<string, string>()
  let failNextSet = false
  let revision = 1
  let status: 'loading' | 'ready' = opts.startLoading === true ? 'loading' : 'ready'
  const snapshotOf = () => status === 'loading'
    ? { status: 'loading' as const, value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' as const }
    : { status: 'ready' as const, value: JSON.parse(JSON.stringify(view)) as Record<string, unknown>, base: undefined, user: JSON.parse(JSON.stringify(view)) as Record<string, unknown>, revision, writable: true, mode: 'host' as const }
  const listeners = new Set<() => void>()
  const publish = (): void => { for (const listener of listeners) listener() }
  const scope = {
    getSnapshot: () => snapshotOf(),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field: string, value: unknown) => {
      view[field] = value
      revision += 1
      publish()
    },
    unset: async (field: string) => {
      delete view[field]
      revision += 1
      publish()
    },
    mutate: async (ops: Array<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>) => {
      for (const op of ops) applyOp(view, op)
      revision += 1
      publish()
    },
  }
  const connection: ImageMindClientContext = {
    settingsScope: { bind: () => scope as unknown as ReturnType<ImageMindClientContext['settingsScope']['bind']> },
    remote: {
      credentials: {
        set: async (ref: string, value: string) => {
          if (failNextSet) {
            failNextSet = false
            return { ok: false, error: { message: 'credential store rejected the write (injected)' } }
          }
          credentials.set(ref, value)
          return { ok: true }
        },
        describe: async (refs: string[]) => ({
          ok: true,
          value: Object.fromEntries(refs.map(ref => [ref, { configured: credentials.has(ref), writable: true }])),
        }),
      },
    },
  }
  return {
    connection,
    view,
    setStatus: (next: 'loading' | 'ready') => {
      status = next
      publish()
    },
    credentialStore: credentials,
    failNextCredentialSet: () => { failNextSet = true },
  }
}

/** The stored provider record inside the fake wire, for direct assertions. */
function storedProvider(view: Record<string, unknown>, id: string): Record<string, unknown> | undefined {
  const providers = view['providers']
  if (typeof providers !== 'object' || providers === null) return undefined
  const record = (providers as Record<string, unknown>)[id]
  return typeof record === 'object' && record !== null ? record as Record<string, unknown> : undefined
}

describe('ImageMindSettingsStore persistence', () => {
  let connection: ImageMindClientContext
  let view: Record<string, unknown>

  beforeEach(() => {
    const fake = fakeConnection({})
    connection = fake.connection
    view = fake.view
  })

  it('keyless stays a strict boolean through true → false → true edits', async () => {
    const store = new ImageMindSettingsStore(connection)
    await store.load()
    expect(store.addProvider({
      id: 'ollama',
      displayName: 'Ollama',
      preset: { baseURL: 'http://localhost:11434/v1', model: 'llava', apiKeyEnv: '' },
    })).toBe(true)
    let row = store.store.getSnapshot().providers.find(p => p.id === 'ollama')
    expect(row?.keyless).toBe(true)
    expect(typeof row?.keyless).toBe('boolean')

    store.setProviderKeyless('ollama', false)
    row = store.store.getSnapshot().providers.find(p => p.id === 'ollama')
    expect(row?.keyless).toBe(false)
    expect(typeof row?.keyless).toBe('boolean')

    store.setProviderKeyless('ollama', true)
    row = store.store.getSnapshot().providers.find(p => p.id === 'ollama')
    expect(row?.keyless).toBe(true)
    expect(typeof row?.keyless).toBe('boolean')
  })

  it('displayName survives save + reload', async () => {
    view['providers'] = { 'my-pro': { baseURL: 'https://api.example.com/v1', model: 'm1' } }
    const store = new ImageMindSettingsStore(connection)
    await store.load()
    expect(store.store.getSnapshot().providers[0]?.displayName).toBe('my-pro')

    store.editProvider('my-pro', 'displayName', 'My Vision')
    expect(store.store.getSnapshot().shell.dirty).toBe(true)
    expect(store.planOps()).toEqual(expect.arrayContaining([
      { op: 'set', path: ['providers', 'my-pro', 'displayName'], value: 'My Vision' },
    ]))
    await store.save()

    // A fresh store (simulating a reload) reads the saved displayName.
    const store2 = new ImageMindSettingsStore(connection)
    await store2.load()
    const row = store2.store.getSnapshot().providers.find(p => p.id === 'my-pro')
    expect(row?.displayName).toBe('My Vision')
    expect(storedProvider(view, 'my-pro')?.['displayName']).toBe('My Vision')
  })

  it('keyless survives save + reload in both directions', async () => {
    view['providers'] = { remote: { baseURL: 'https://api.example.com/v1', model: 'm1' } }
    const store = new ImageMindSettingsStore(connection)
    await store.load()
    expect(store.store.getSnapshot().providers.find(p => p.id === 'remote')?.keyless).toBe(false)

    store.setProviderKeyless('remote', true)
    await store.save()
    expect(storedProvider(view, 'remote')?.['keyless']).toBe(true)

    const store2 = new ImageMindSettingsStore(connection)
    await store2.load()
    expect(store2.store.getSnapshot().providers.find(p => p.id === 'remote')?.keyless).toBe(true)

    // Toggle OFF: the stored flag is unset (absent reads as false, never a string).
    store2.setProviderKeyless('remote', false)
    await store2.save()
    expect(storedProvider(view, 'remote')?.['keyless']).toBeUndefined()

    const store3 = new ImageMindSettingsStore(connection)
    await store3.load()
    const finalRow = store3.store.getSnapshot().providers.find(p => p.id === 'remote')
    expect(finalRow?.keyless).toBe(false)
    expect(typeof finalRow?.keyless).toBe('boolean')
  })

  it('dirty-but-no-op invariant: every dirty edit plans a real op', async () => {
    view['providers'] = {
      a: { baseURL: 'https://api.example.com/v1', model: 'm1' },
    }
    const store = new ImageMindSettingsStore(connection)
    await store.load()
    expect(store.store.getSnapshot().shell.dirty).toBe(false)

    // displayName edit → a displayName op exists.
    store.editProvider('a', 'displayName', 'A')
    expect(store.store.getSnapshot().shell.dirty).toBe(true)
    expect(store.planOps().some(op => op.op === 'set' && op.path.join('.') === 'providers.a.displayName')).toBe(true)

    // keyless edit → a keyless op exists (set when the saved state is false).
    store.setProviderKeyless('a', true)
    expect(store.planOps().some(op => op.op === 'set' && op.path.join('.') === 'providers.a.keyless' && op.value === true)).toBe(true)

    // Reverting keyless to the saved state plans no keyless op; the displayName
    // edit keeps the view dirty and its op present (invariant holds).
    store.setProviderKeyless('a', false)
    expect(store.planOps().some(op => op.path.join('.') === 'providers.a.keyless')).toBe(false)
    expect(store.store.getSnapshot().shell.dirty).toBe(true)
    expect(store.planOps().some(op => op.op === 'set' && op.path.join('.') === 'providers.a.displayName')).toBe(true)

    // Saving the displayName-only edit persists it and clears the dirty flag.
    await store.save()
    expect(store.store.getSnapshot().shell.dirty).toBe(false)
    expect(storedProvider(view, 'a')?.['displayName']).toBe('A')
    expect(storedProvider(view, 'a')?.['keyless']).toBeUndefined()
  })

  it('a pure no-op view is never dirty and saves nothing', async () => {
    view['providers'] = { a: { baseURL: 'https://api.example.com/v1', model: 'm1' } }
    const store = new ImageMindSettingsStore(connection)
    await store.load()
    expect(store.store.getSnapshot().shell.dirty).toBe(false)
    expect(store.planOps()).toEqual([])
    expect(store.pendingCredentialWrites()).toEqual([])
    await store.save() // must not throw and must not write
    expect(storedProvider(view, 'a')).toEqual({ baseURL: 'https://api.example.com/v1', model: 'm1' })
  })

  it('follows the scope mirror from loading to ready (browser lifecycle regression)', async () => {
    // The rc.1 browser journey failure: the store snapshotted the scope once
    // while it was still `loading` and never became visible. A bound scope is
    // an observable mirror — the store must subscribe and follow it into
    // `ready`, then keep following document updates.
    const fake = fakeConnection(
      { providers: { a: { baseURL: 'https://api.example.com/v1', model: 'm1' } }, active: 'a' },
      { startLoading: true },
    )
    const store = new ImageMindSettingsStore(fake.connection)
    // Initial snapshot is loading: card not exposed yet.
    expect(store.store.getSnapshot().shell.available).toBe(false)
    expect(store.store.getSnapshot().shell.exposed).toBe(false)

    // Mirror reaches ready: subscribers fire, store must become exposed.
    fake.setStatus('ready')
    await new Promise(resolve => setImmediate(resolve))
    await store.load()
    const ready = store.store.getSnapshot()
    expect(ready.shell.exposed).toBe(true)
    expect(ready.shell.writable).toBe(true)
    expect(ready.providers.find(p => p.id === 'a')?.model).toBe('m1')

    // A later document update through the mirror is followed without remount.
    fake.view['providers'] = { a: { baseURL: 'https://api.example.com/v1', model: 'm2' }, active: 'a' }
    fake.setStatus('loading')
    fake.setStatus('ready')
    await new Promise(resolve => setImmediate(resolve))
    await store.load()
    expect(store.store.getSnapshot().providers.find(p => p.id === 'a')?.model).toBe('m2')

    store.dispose()
  })

  it('exposes nothing when no settings scope is available', async () => {
    const store = new ImageMindSettingsStore({} as ImageMindClientContext)
    // No scope → the card must not paint at all (available tracks ready).
    expect(store.store.getSnapshot().shell.available).toBe(false)
    expect(store.store.getSnapshot().shell.exposed).toBe(false)
    expect(store.store.getSnapshot().transport).toBe('unavailable')
    store.dispose()
  })
})

describe('ImageMindSettingsStore fail-safe save ordering', () => {
  it('writes required credentials before publishing settings that reference them', async () => {
    const fake = fakeConnection({})
    const store = new ImageMindSettingsStore(fake.connection)
    await store.load()
    store.addProvider({
      id: 'sec',
      displayName: 'Secure',
      preset: { baseURL: 'https://api.sec.example/v1', model: 'm1', apiKeyEnv: 'SEC_REF' },
    })
    // Type a real key (not a mask).
    store.editProvider('sec', 'apiKeyText', 'sk-real-value')

    await store.save()
    expect(fake.credentialStore.has('SEC_REF')).toBe(true)
    expect(fake.credentialStore.get('SEC_REF')).toBe('sk-real-value')
    expect(storedProvider(fake.view, 'sec')?.['apiKeyEnv']).toBe('SEC_REF')
  })

  it('does not mutate settings when a credential write fails', async () => {
    const fake = fakeConnection({})
    const store = new ImageMindSettingsStore(fake.connection)
    await store.load()
    store.addProvider({
      id: 'sec',
      displayName: 'Secure',
      preset: { baseURL: 'https://api.sec.example/v1', model: 'm1', apiKeyEnv: 'SEC_REF' },
    })
    store.editProvider('sec', 'apiKeyText', 'sk-real-value')
    fake.failNextCredentialSet()

    await store.save()
    expect(store.store.getSnapshot().shell.failed).toBe(true)
    // Settings untouched: the provider was never published.
    expect(storedProvider(fake.view, 'sec')).toBeUndefined()
    expect(fake.credentialStore.has('SEC_REF')).toBe(false)
    // Drafts remain so the user can retry.
    expect(store.store.getSnapshot().shell.dirty).toBe(true)
  })

  it('includes the derived apiKeyEnv in the single settings mutation', async () => {
    const fake = fakeConnection({})
    const store = new ImageMindSettingsStore(fake.connection)
    await store.load()
    // New provider with no explicit apiKeyEnv: typed key derives a ref.
    store.addProvider({
      id: 'sec',
      displayName: 'Secure',
      preset: { baseURL: 'https://api.sec.example/v1', model: 'm1', apiKeyEnv: '' },
    })
    store.editProvider('sec', 'apiKeyText', 'sk-typed')

    const ops = store.planOps()
    // The derived ref rides inside the single whole-provider `set` op for a
    // brand-new provider (path = ['providers','sec']), so exactly one op
    // carries an apiKeyEnv equal to the derived reference.
    const providerSet = ops.find(op => op.op === 'set' && op.path.length === 2 && op.path[0] === 'providers' && op.path[1] === 'sec')
    expect(providerSet).toBeDefined()
    const setValue = (providerSet as { value?: Record<string, unknown> }).value ?? {}
    expect(setValue['apiKeyEnv']).toBe(deriveKeyRef('sec'))
    // No separate field-level apiKeyEnv op exists (single mutation).
    const fieldEnvOps = ops.filter(op => op.path.length === 3 && op.path[2] === 'apiKeyEnv')
    expect(fieldEnvOps).toHaveLength(0)

    await store.save()
    // One settings commit carried the derived ref.
    const env = storedProvider(fake.view, 'sec')?.['apiKeyEnv']
    expect(typeof env).toBe('string')
    expect(String(env).length).toBeGreaterThan(0)
    expect(fake.credentialStore.has(String(env))).toBe(true)
  })

  it('keeps drafts dirty after a settings revision conflict', async () => {
    const fake = fakeConnection({})
    const store = new ImageMindSettingsStore(fake.connection)
    await store.load()
    store.editProvider('p1', 'displayName', 'Renamed')
    // Simulate a conflict: another writer bumps the revision behind the store.
    store.editProvider('p1', 'displayName', 'Renamed2')
    // Force a write-through failure by removing the settings face.
    const broken = new ImageMindSettingsStore({} as never)
    await expect(broken.save()).resolves.toBeUndefined()
    // The real store still has a live scope; force conflict by pre-mutating view.
    fake.view['active'] = 'someone-else'
    // writeThroughScope in the fake mutate does not conflict-check; emulate via
    // a store whose scope resolves but whose mutate rejects.
    const store2 = new ImageMindSettingsStore({
      settingsScope: { bind: () => ({
        getSnapshot: () => ({ status: 'ready' as const, value: {}, base: undefined, user: {}, revision: 1, writable: true, mode: 'host' as const }),
        subscribe: () => () => {},
        mutate: async () => { throw new Error('revision conflict') },
      }) },
      remote: { credentials: { set: async () => ({ ok: true }), describe: async () => ({ ok: true, value: {} }) } },
    } as never)
    await store2.load()
    store2.editProvider('p1', 'displayName', 'Renamed')
    await store2.save()
    expect(store2.store.getSnapshot().shell.failed).toBe(true)
    expect(store2.store.getSnapshot().shell.dirty).toBe(true)
    expect(store2.planOps().length).toBeGreaterThan(0)
  })
})
