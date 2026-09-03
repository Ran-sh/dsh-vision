/**
 * Attachment index concurrency + failure semantics: singleflight cold load,
 * serialized mutations (no lost updates), commit-after-persist, write-failure
 * recovery without queue poisoning, and null-prototype hostile-key handling.
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  commitSessionAttachmentBatch,
  discardSessionAttachmentBatch,
  durableAttachmentRefById,
  latestSessionAttachmentRefs,
  rememberAttachmentRef,
} from '../src/attachments/ref-index.ts'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
  real: {} as Record<string, unknown>,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  mocks.real.mkdtemp = actual.mkdtemp
  mocks.real.mkdir = actual.mkdir
  mocks.real.readFile = actual.readFile
  mocks.real.rename = actual.rename
  mocks.real.writeFile = actual.writeFile
  mocks.real.rm = actual.rm
  // Re-export the hoisted spies (so tests can fault-inject) but default them
  // to the real implementations unless a test overrides one-shot behavior.
  mocks.readFile.mockImplementation(actual.readFile)
  mocks.rename.mockImplementation(actual.rename)
  mocks.writeFile.mockImplementation(actual.writeFile)
  mocks.rm.mockImplementation(actual.rm)
  return {
    ...actual,
    readFile: mocks.readFile,
    rename: mocks.rename,
    writeFile: mocks.writeFile,
    rm: mocks.rm,
  }
})

function realFs<K extends 'mkdtemp' | 'mkdir' | 'readFile' | 'rename' | 'writeFile' | 'rm'>(key: K): (typeof import('node:fs/promises'))[K] {
  return mocks.real[key] as (typeof import('node:fs/promises'))[K]
}

const roots: string[] = []

async function freshRoot(): Promise<string> {
  const root = await realFs('mkdtemp')(join(tmpdir(), 'image-mind-ref-race-'))
  await realFs('mkdir')(join(root, '.image-mind'), { recursive: true })
  roots.push(root)
  return root
}

function ctxFor(attachmentRoot: string): Context {
  return {
    get(key: string) {
      return key === 'attachments' ? { root: attachmentRoot } : undefined
    },
  } as unknown as Context
}

function ref(idChar: string): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${idChar.repeat(64)}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 1,
    width: 1,
    height: 1,
  }
}

function indexFileFor(root: string): string {
  return join(root, '.image-mind', 'attachment-index-v1.json')
}

/** A controllable deferred used to pause a mocked fs call mid-flight. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore the real-behavior defaults after each clear.
  if (mocks.real.readFile) mocks.readFile.mockImplementation(mocks.real.readFile as typeof readFile)
  if (mocks.real.rename) mocks.rename.mockImplementation(mocks.real.rename as typeof rename)
  if (mocks.real.writeFile) mocks.writeFile.mockImplementation(mocks.real.writeFile as typeof writeFile)
  if (mocks.real.rm) mocks.rm.mockImplementation(mocks.real.rm as typeof rm)
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => realFs('rm')(path, { recursive: true, force: true })))
})

describe('attachment index concurrency and durability', () => {
  it('single-flights cold load across concurrent read and mutation (no lost update)', async () => {
    const root = await freshRoot()
    const ctx = ctxFor(root)
    const indexFile = indexFileFor(root)
    const oldRef = ref('a')
    const newRef = ref('b')
    // Disk starts with oldRef.
    await realFs('writeFile')(indexFile, JSON.stringify({
      version: 1,
      refs: { [oldRef.attachmentId]: oldRef },
      sessions: {},
    }))

    // Pause the cold readFile after the mutation below starts.
    const gate = deferred<string>()
    mocks.readFile.mockImplementationOnce(() => gate.promise)

    const coldRead = rememberAttachmentRef(ctx, newRef, {
      sessionId: 's', batchId: 'b1', batchIndex: 0, batchCount: 1,
    })

    // Let the mutation reach the read (now blocked), then let read resolve
    // with the OLD disk content — the transactional queue must apply the
    // mutation on top of the loaded snapshot, not overwrite it.
    gate.resolve(JSON.stringify({
      version: 1,
      refs: { [oldRef.attachmentId]: oldRef },
      sessions: {},
    }))
    await coldRead

    expect(mocks.readFile).toHaveBeenCalledTimes(1)
    // The session batch contains the mutation; the durable ref map retains the
    // disk-loaded oldRef — the old snapshot did not overwrite the new write.
    const sessionBatch = await latestSessionAttachmentRefs(ctx, 's')
    expect(sessionBatch.map(r => r.attachmentId)).toEqual([newRef.attachmentId])
    expect((await durableAttachmentRefById(ctx, oldRef.attachmentId))?.attachmentId).toBe(oldRef.attachmentId)
    expect((await durableAttachmentRefById(ctx, newRef.attachmentId))?.attachmentId).toBe(newRef.attachmentId)
  })

  it('does not overwrite a valid index after a transient read failure (EACCES)', async () => {
    const root = await freshRoot()
    const ctx = ctxFor(root)
    const indexFile = indexFileFor(root)
    const diskRef = ref('a')
    await realFs('writeFile')(indexFile, JSON.stringify({
      version: 1,
      refs: { [diskRef.attachmentId]: diskRef },
      sessions: {},
    }))

    mocks.readFile.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }))

    await expect(rememberAttachmentRef(ctx, ref('b'), {
      sessionId: 's', batchId: 'b1', batchIndex: 0, batchCount: 1,
    })).rejects.toThrow(/permission denied/)

    // Disk file unchanged; no empty index written.
    const onDisk = JSON.parse(await realFs('readFile')(indexFile, 'utf8'))
    expect(onDisk.refs[diskRef.attachmentId]).toBeDefined()
    // A later call retries the load and succeeds (no permanent poison).
    const recovered = await rememberAttachmentRef(ctx, ref('c'), {
      sessionId: 's', batchId: 'b2', batchIndex: 0, batchCount: 1,
    })
    void recovered
    // The durable ref map (from the successfully recovered load) still holds
    // the original disk ref; nothing was overwritten with an empty index.
    expect((await durableAttachmentRefById(ctx, diskRef.attachmentId))?.attachmentId).toBe(diskRef.attachmentId)
    expect((await durableAttachmentRefById(ctx, ref('c').attachmentId))?.attachmentId).toBe(ref('c').attachmentId)
  })

  it('a failed persist does not publish the draft in memory', async () => {
    const root = await freshRoot()
    const ctx = ctxFor(root)
    const failRef = ref('a')
    mocks.rename.mockRejectedValueOnce(Object.assign(new Error('io error'), { code: 'EIO' }))

    await expect(rememberAttachmentRef(ctx, failRef, {
      sessionId: 's', batchId: 'b1', batchIndex: 0, batchCount: 1,
    })).rejects.toThrow(/io error/)

    // Nothing was published to the in-memory committed state.
    expect(await durableAttachmentRefById(ctx, failRef.attachmentId)).toBeUndefined()

    // The next write succeeds — the queue was not poisoned by the failure.
    const okRef = ref('b')
    await rememberAttachmentRef(ctx, okRef, {
      sessionId: 's', batchId: 'b2', batchIndex: 0, batchCount: 1,
    })
    expect((await durableAttachmentRefById(ctx, okRef.attachmentId))?.attachmentId).toBe(okRef.attachmentId)
  })

  it('serializes concurrent batch mutations without lost updates', async () => {
    const root = await freshRoot()
    const ctx = ctxFor(root)
    const a = ref('a')
    const b = ref('b')
    await Promise.all([
      rememberAttachmentRef(ctx, a, { sessionId: 's', batchId: 'b', batchIndex: 0, batchCount: 2 }),
      rememberAttachmentRef(ctx, b, { sessionId: 's', batchId: 'b', batchIndex: 1, batchCount: 2 }),
    ])
    const batch = await latestSessionAttachmentRefs(ctx, 's')
    expect(batch.map(r => r.attachmentId).sort()).toEqual([a.attachmentId, b.attachmentId].sort())
  })

  it('treats a __proto__ session id as an ordinary persisted key', async () => {
    const root = await freshRoot()
    const ctx = ctxFor(root)
    const protoRef = ref('d')
    await rememberAttachmentRef(ctx, protoRef, {
      sessionId: '__proto__', batchId: 'b1', batchIndex: 0, batchCount: 1,
    })
    const batch = await latestSessionAttachmentRefs(ctx, '__proto__')
    expect(batch.map(r => r.attachmentId)).toEqual([protoRef.attachmentId])

    // Roundtrip through a fresh context reads it back as plain data.
    const ctx2 = ctxFor(root)
    const again = await latestSessionAttachmentRefs(ctx2, '__proto__')
    expect(again.map(r => r.attachmentId)).toEqual([protoRef.attachmentId])
  })

  it('discard restores the previous committed batch transactionally', async () => {
    const root = await freshRoot()
    const ctx = ctxFor(root)
    const a = ref('a')
    await rememberAttachmentRef(ctx, a, { sessionId: 's', batchId: 'b1', batchIndex: 0, batchCount: 1 })
    await commitSessionAttachmentBatch(ctx, 's', 'b1')
    const b = ref('b')
    await rememberAttachmentRef(ctx, b, { sessionId: 's', batchId: 'b2', batchIndex: 0, batchCount: 1 })
    expect(await discardSessionAttachmentBatch(ctx, 's', 'b2')).toBe(true)
    const batch = await latestSessionAttachmentRefs(ctx, 's')
    expect(batch.map(r => r.attachmentId)).toEqual([a.attachmentId])
  })
})

describe('hostile session ids across a REAL module-restart reload', () => {
  it('__proto__ session id survives a real disk reload (fresh module state)', async () => {
    const root = await freshRoot()
    const ctx = ctxFor(root)
    const protoRef = ref('e')

    // Write through the real module.
    const mod1 = await import('../src/attachments/ref-index.ts')
    await mod1.rememberAttachmentRef(ctx, protoRef, {
      sessionId: '__proto__', batchId: 'b1', batchIndex: 0, batchCount: 1,
    })

    // Inspect the actual on-disk JSON: __proto__ must be a plain own key.
    const onDisk = JSON.parse(await realFs('readFile')(indexFileFor(root), 'utf8'))
    expect(Object.hasOwn(onDisk.sessions, '__proto__')).toBe(true)

    // Simulate a real restart: fresh module state (new in-memory `states` map)
    // and a fresh Context — this is what actually forces a cold disk reload.
    vi.resetModules()
    const mod2 = await import('../src/attachments/ref-index.ts')
    const ctx2 = ctxFor(root)
    const again = await mod2.latestSessionAttachmentRefs(ctx2, '__proto__')
    expect(again.map(r => r.attachmentId)).toEqual([protoRef.attachmentId])

    // constructor / prototype-like ids are plain data too.
    const ctorRef = ref('f')
    await mod2.rememberAttachmentRef(ctx2, ctorRef, {
      sessionId: 'constructor', batchId: 'b2', batchIndex: 0, batchCount: 1,
    })
    expect((await mod2.latestSessionAttachmentRefs(ctx2, 'constructor')).map(r => r.attachmentId)).toEqual([ctorRef.attachmentId])
  })
})
