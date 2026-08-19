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

// The real package is browser-only (requires `window`); the store only needs
// its snapshot primitive, which this fake implements faithfully.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
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

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { ImageMindSettingsStore } from '../src/client/settings/store.ts'

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

/** An in-memory fake of the official settings + credentials wire. */
function fakeConnection(initial: Record<string, unknown>): { connection: ConnectionHandle; view: Record<string, unknown> } {
  const view: Record<string, unknown> = JSON.parse(JSON.stringify(initial))
  const credentials = new Map<string, string>()
  let revision = 1
  const connection = {
    isLoopback: true,
    api: {
      settings: {
        describe: async () => ({
          result: {
            ok: true,
            value: { namespaces: [{ ns: 'image-mind', value: view, revision }], writable: true },
          },
        }),
        mutate: async (request: { ns: string; ops: Array<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }> }) => {
          for (const op of request.ops) applyOp(view, op)
          revision += 1
          return { result: { ok: true, value: { ns: request.ns, value: view, revision } } }
        },
      },
      credentials: {
        set: async (request: { ref: string; value: string }) => {
          credentials.set(request.ref, request.value)
          return { result: { ok: true } }
        },
        describe: async (request: { refs: string[] }) => ({
          result: {
            ok: true,
            value: {
              credentials: Object.fromEntries(request.refs.map(ref => [ref, { configured: credentials.has(ref), writable: true }])),
            },
          },
        }),
      },
    },
  } as unknown as ConnectionHandle
  return { connection, view }
}

/** The stored provider record inside the fake wire, for direct assertions. */
function storedProvider(view: Record<string, unknown>, id: string): Record<string, unknown> | undefined {
  const providers = view['providers']
  if (typeof providers !== 'object' || providers === null) return undefined
  const record = (providers as Record<string, unknown>)[id]
  return typeof record === 'object' && record !== null ? record as Record<string, unknown> : undefined
}

describe('ImageMindSettingsStore persistence', () => {
  let connection: ConnectionHandle
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
})
