/**
 * Durable image-mind attachment metadata and session-batch index.
 *
 * Attachment bytes remain owned by DSH. This index stores only validated
 * metadata plus bounded session routing/preview ledgers so neither model
 * recovery nor conversation previews need raw attachment metadata embedded in
 * user-visible conversation text.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { parseImageAttachmentRef, registerAttachmentRef } from './store.ts'

const INDEX_VERSION = 1
const MAX_REFS = 512
const MAX_SESSIONS = 128
const MAX_HISTORY_BATCHES = 64
const INDEX_DIR = '.image-mind'
const INDEX_FILE = 'attachment-index-v1.json'

interface SessionBatch {
  batchId: string
  count: number
  refs: Record<string, string>
  updatedAt: number
}

interface SessionRecord extends SessionBatch {
  /** Successfully admitted image sends, oldest first. */
  history: SessionBatch[]
}

interface PersistedIndex {
  version: 1
  refs: Record<string, ImageAttachmentRef>
  sessions: Record<string, SessionRecord>
}

interface IndexState {
  value: PersistedIndex
  loaded: boolean
  writeTail: Promise<void>
}

const volatileState: IndexState = { value: emptyIndex(), loaded: true, writeTail: Promise.resolve() }
const states = new Map<string, IndexState>()

function emptyIndex(): PersistedIndex {
  return { version: INDEX_VERSION, refs: {}, sessions: {} }
}

function storeRoot(ctx: Context): string | undefined {
  const attachments = ctx.get('attachments') as ({ root?: unknown } | undefined)
  return typeof attachments?.root === 'string' && attachments.root.length > 0
    ? attachments.root
    : undefined
}

function indexPath(ctx: Context): string | undefined {
  const root = storeRoot(ctx)
  return root === undefined ? undefined : join(root, INDEX_DIR, INDEX_FILE)
}

function stateFor(ctx: Context): { state: IndexState; path?: string } {
  const path = indexPath(ctx)
  if (path === undefined) return { state: volatileState }
  let state = states.get(path)
  if (state === undefined) {
    state = { value: emptyIndex(), loaded: false, writeTail: Promise.resolve() }
    states.set(path, state)
  }
  return { state, path }
}

function validSessionBatch(raw: unknown): SessionBatch | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const batchId = record['batchId']
  const count = record['count']
  const refs = record['refs']
  const updatedAt = record['updatedAt']
  if (typeof batchId !== 'string' || batchId.length === 0 || batchId.length > 128) return undefined
  if (!Number.isSafeInteger(count) || (count as number) <= 0 || (count as number) > 8) return undefined
  if (!Number.isSafeInteger(updatedAt) || (updatedAt as number) < 0) return undefined
  if (typeof refs !== 'object' || refs === null || Array.isArray(refs)) return undefined
  const cleanRefs: Record<string, string> = {}
  for (const [key, value] of Object.entries(refs as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(value)) continue
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index < 0 || index >= (count as number)) continue
    cleanRefs[key] = value
  }
  return { batchId, count: count as number, refs: cleanRefs, updatedAt: updatedAt as number }
}

function validSessionRecord(raw: unknown): SessionRecord | undefined {
  const latest = validSessionBatch(raw)
  if (latest === undefined) return undefined
  const record = raw as Record<string, unknown>
  const rawHistory = record['history']
  const history: SessionBatch[] = []
  if (Array.isArray(rawHistory)) {
    for (const value of rawHistory.slice(-MAX_HISTORY_BATCHES)) {
      const batch = validSessionBatch(value)
      if (batch !== undefined && isCompleteBatch(batch)) history.push(batch)
    }
  }
  return { ...latest, history }
}

function parsePersistedIndex(raw: unknown): PersistedIndex {
  const next = emptyIndex()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return next
  const record = raw as Record<string, unknown>
  if (record['version'] !== INDEX_VERSION) return next

  const refs = record['refs']
  if (typeof refs === 'object' && refs !== null && !Array.isArray(refs)) {
    for (const [id, value] of Object.entries(refs as Record<string, unknown>).slice(-MAX_REFS)) {
      try {
        const ref = parseImageAttachmentRef(JSON.stringify(value))
        if (ref.attachmentId === id) {
          next.refs[id] = ref
          registerAttachmentRef(ref)
        }
      } catch {
        // Corrupt metadata is ignored; attachment bytes stay untouched.
      }
    }
  }

  const sessions = record['sessions']
  if (typeof sessions === 'object' && sessions !== null && !Array.isArray(sessions)) {
    for (const [sessionId, value] of Object.entries(sessions as Record<string, unknown>).slice(-MAX_SESSIONS)) {
      if (sessionId.length === 0 || sessionId.length > 256) continue
      const session = validSessionRecord(value)
      if (session !== undefined) next.sessions[sessionId] = session
    }
  }
  return next
}

async function ensureLoaded(ctx: Context): Promise<{ state: IndexState; path?: string }> {
  const holder = stateFor(ctx)
  if (holder.state.loaded) return holder
  holder.state.loaded = true
  if (holder.path === undefined) return holder
  try {
    const text = await readFile(holder.path, 'utf8')
    holder.state.value = parsePersistedIndex(JSON.parse(text) as unknown)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      holder.state.value = emptyIndex()
    }
  }
  return holder
}

function trimOldest<T extends { updatedAt: number }>(record: Record<string, T>, cap: number): void {
  const overflow = Object.keys(record).length - cap
  if (overflow <= 0) return
  const oldest = Object.entries(record)
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    .slice(0, overflow)
  for (const [key] of oldest) delete record[key]
}

function isCompleteBatch(batch: SessionBatch): boolean {
  for (let index = 0; index < batch.count; index += 1) {
    if (batch.refs[String(index)] === undefined) return false
  }
  return true
}

function trimRefs(index: PersistedIndex): void {
  const ids = Object.keys(index.refs)
  if (ids.length <= MAX_REFS) return
  const pinned = new Set<string>()
  for (const session of Object.values(index.sessions)) {
    for (const id of Object.values(session.refs)) pinned.add(id)
    for (const batch of session.history) {
      for (const id of Object.values(batch.refs)) pinned.add(id)
    }
  }
  for (const id of ids) {
    if (Object.keys(index.refs).length <= MAX_REFS) break
    if (!pinned.has(id)) delete index.refs[id]
  }
}

async function persist(holder: { state: IndexState; path?: string }): Promise<void> {
  if (holder.path === undefined) return
  const path = holder.path
  const snapshot = JSON.stringify(holder.state.value)
  holder.state.writeTail = holder.state.writeTail.then(async () => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  })
  await holder.state.writeTail
}

export interface AttachmentBatchPosition {
  sessionId: string
  batchId: string
  batchIndex: number
  batchCount: number
}

export interface SessionPreviewBatch {
  batchId: string
  count: number
  updatedAt: number
}

/** Remember one validated stored ref and associate it with the latest routing batch. */
export async function rememberAttachmentRef(
  ctx: Context,
  ref: ImageAttachmentRef,
  position?: AttachmentBatchPosition,
): Promise<void> {
  registerAttachmentRef(ref)
  const holder = await ensureLoaded(ctx)
  holder.state.value.refs[ref.attachmentId] = ref

  if (position !== undefined) {
    const previous = holder.state.value.sessions[position.sessionId]
    const history = previous?.history ?? []
    const session: SessionRecord = previous?.batchId === position.batchId && previous.count === position.batchCount
      ? previous
      : {
          batchId: position.batchId,
          count: position.batchCount,
          refs: {},
          updatedAt: Date.now(),
          history,
        }
    session.refs[String(position.batchIndex)] = ref.attachmentId
    session.updatedAt = Date.now()
    holder.state.value.sessions[position.sessionId] = session
    trimOldest(holder.state.value.sessions, MAX_SESSIONS)
  }

  trimRefs(holder.state.value)
  await persist(holder)
}

/** Resolve a complete validated reference by content id, including after restart. */
export async function durableAttachmentRefById(ctx: Context, id: string): Promise<ImageAttachmentRef | undefined> {
  const holder = await ensureLoaded(ctx)
  const ref = holder.state.value.refs[id]
  if (ref !== undefined) registerAttachmentRef(ref)
  return ref
}

/** Resolve the latest complete ordered image batch associated with a DSH session. */
export async function latestSessionAttachmentRefs(ctx: Context, sessionId: string): Promise<ImageAttachmentRef[]> {
  const holder = await ensureLoaded(ctx)
  const batch = holder.state.value.sessions[sessionId]
  if (batch === undefined || !isCompleteBatch(batch)) return []
  const refs: ImageAttachmentRef[] = []
  for (let index = 0; index < batch.count; index += 1) {
    const id = batch.refs[String(index)]
    const ref = id === undefined ? undefined : holder.state.value.refs[id]
    if (ref === undefined) return []
    registerAttachmentRef(ref)
    refs.push(ref)
  }
  return refs
}

/**
 * Mark the latest uploaded batch as durably visible in conversation history.
 * This is called only after session.prompt succeeds, so failed sends cannot
 * steal a historical marker from an older successful message.
 */
export async function commitSessionAttachmentBatch(
  ctx: Context,
  sessionId: string,
  batchId: string,
): Promise<boolean> {
  const holder = await ensureLoaded(ctx)
  const session = holder.state.value.sessions[sessionId]
  if (session === undefined || session.batchId !== batchId || !isCompleteBatch(session)) return false
  if (session.history.some(batch => batch.batchId === batchId)) return true
  const committed: SessionBatch = {
    batchId: session.batchId,
    count: session.count,
    refs: { ...session.refs },
    updatedAt: Date.now(),
  }
  session.history.push(committed)
  if (session.history.length > MAX_HISTORY_BATCHES) {
    session.history.splice(0, session.history.length - MAX_HISTORY_BATCHES)
  }
  session.updatedAt = committed.updatedAt
  trimRefs(holder.state.value)
  await persist(holder)
  return true
}

/** Return bounded committed preview batches without exposing attachment ids. */
export async function sessionAttachmentPreviewBatches(ctx: Context, sessionId: string): Promise<SessionPreviewBatch[]> {
  const holder = await ensureLoaded(ctx)
  const session = holder.state.value.sessions[sessionId]
  if (session === undefined) return []
  return session.history.map(batch => ({
    batchId: batch.batchId,
    count: batch.count,
    updatedAt: batch.updatedAt,
  }))
}

/** Resolve one committed preview image by opaque batch id + ordinal. */
export async function previewAttachmentRef(
  ctx: Context,
  batchId: string,
  batchIndex: number,
): Promise<ImageAttachmentRef | undefined> {
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0) return undefined
  const holder = await ensureLoaded(ctx)
  for (const session of Object.values(holder.state.value.sessions)) {
    const batch = session.history.find(candidate => candidate.batchId === batchId)
    if (batch === undefined || batchIndex >= batch.count) continue
    const id = batch.refs[String(batchIndex)]
    if (id === undefined) return undefined
    const ref = holder.state.value.refs[id]
    if (ref !== undefined) registerAttachmentRef(ref)
    return ref
  }
  return undefined
}
