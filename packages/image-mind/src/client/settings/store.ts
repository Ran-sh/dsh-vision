/**
 * The image-mind settings store: one snapshot joining the namespace view
 * (settings.describe) with the referenced credentials (credentials.describe).
 * The host stays the single fact source — every mutation writes through the
 * official wire and the snapshot re-renders from the next view.
 *
 * Writes are path-addressed (`settings.mutate`), the same contract the
 * official Models page uses: the card names only the fields it can see, so a
 * redacted descriptor can never delete a secret the wire never returned.
 * @module dsh-plugin-image-mind/client/settings/store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  describeCredentialOfficial, resolveScope, setCredentialOfficial,
  snapshotFromBoundScope, writeThroughScope,
  type ImageMindClientContext, type SettingsOp, type SettingsSnapshot,
} from './transport.ts'

/** One provider as the browser edits it (all string drafts; secret kept write-only). */
export interface ProviderDraft {
  /** Presentation name; never the route identity. */
  displayName: string
  baseURL: string
  model: string
  apiKeyEnv: string
  apiStyle: string
  maxOutputTokens: string
  /** The API key input: '' (untouched), a mask, or a newly-typed inline key. */
  apiKeyText: string
  /** Whether a key is configured today (credential store or inline legacy). */
  apiKeyConfigured: boolean
  apiKeyMask: string
  /** Whether this provider needs no credential (local endpoints, explicit config). */
  keyless: boolean
  /**
   * Stable staging credential ref for a typed key that would otherwise
   * overwrite a live credential still referenced by the committed settings.
   * Created once per draft and reused across retries so a CAS conflict never
   * rotates the old credential before the new settings commit.
   */
  stagingRef?: string
}

/** One provider row the renderer consumes. */
export interface ProviderCardState extends ProviderDraft {
  id: string
  /** endpoint+model filled (regardless of key). */
  complete: boolean
  /** a key actually resolves today (credential store or env seam), or keyless. */
  keyReady: boolean
  /** The provider needs a credential and none resolves. */
  missingKey: boolean
}

/** The whole image-mind card state. */
export interface ImageMindSettingsState {
  shell: {
    available: boolean
    exposed: boolean
    writable: boolean
    dirty: boolean
    invalid: boolean
    saving: boolean
    failed: boolean
    failedReason?: string
  }
  providers: ProviderCardState[]
  active: string
  defaultPrompt: string
  maxBytes: string
  timeoutMs: string
  renderImagePreview: string
  /** The credential refs referenced by providers, for batch describe. */
  refs: string[]
  /** Which transport is live: 'official' | 'legacy' | 'unavailable'. */
  transport: 'official' | 'legacy' | 'unavailable'
}

/** A provider id, normalized from a user-entered name (trim, no spaces). */
export function normalizeId(name: string): string {
  return name.trim().replace(/\s+/g, '-')
}

// The conventional credential reference for a provider route is owned by the
// host credential layer (shared with the legacy-key migration); the card
// re-exports it so the browser never keeps a second definition.
import { deriveKeyRef, isValidProviderId, isKeylessBaseURL, connectionFingerprint, PROVIDER_ID_RE } from './identity.ts'
export { deriveKeyRef, isValidProviderId, isKeylessBaseURL, connectionFingerprint, PROVIDER_ID_RE }

/** Read one top-level string field from a snapshot value. */
export function topText(value: Record<string, unknown> | undefined, field: string): string {
  const raw = value?.[field]
  if (raw === undefined || raw === null) return ''
  return typeof raw === 'string' ? raw : String(raw)
}

/** Build a draft provider from a loaded provider record (or a blank one). */
export function draftOf(id: string, record: Record<string, unknown> | undefined, configured: boolean, mask: string): ProviderDraft {
  const provider = record ?? {}
  const rawBaseURL = typeof provider['baseURL'] === 'string' ? provider['baseURL'] : ''
  return {
    displayName: typeof provider['displayName'] === 'string' && provider['displayName'].trim().length > 0 ? provider['displayName'] : id,
    baseURL: rawBaseURL,
    model: typeof provider['model'] === 'string' ? provider['model'] : '',
    apiKeyEnv: typeof provider['apiKeyEnv'] === 'string' ? provider['apiKeyEnv'] : '',
    apiStyle: typeof provider['apiStyle'] === 'string' ? provider['apiStyle'] : 'chat-completions',
    maxOutputTokens: provider['maxOutputTokens'] !== undefined ? String(provider['maxOutputTokens']) : '1024',
    apiKeyText: mask,
    apiKeyConfigured: configured,
    apiKeyMask: mask,
    keyless: typeof provider['keyless'] === 'boolean' ? provider['keyless'] : isKeylessBaseURL(rawBaseURL),
    stagingRef: undefined,
  }
}

/** Stable per-draft staging ref slots for a provider route. Two slots let a
 * committed staging ref be vacated by the next edit: the selector always picks
 * a slot that is NOT currently live, so a successful commit followed by a new
 * edit never overwrites a ref the committed settings still reference. */
function stagingSlotA(id: string): string {
  return `${deriveKeyRef(id)}_STAGING_A`
}

function stagingSlotB(id: string): string {
  return `${deriveKeyRef(id)}_STAGING_B`
}

/**
 * Pick a staging slot that is neither live (referenced by committed settings
 * or already claimed in this save) nor — when the draft already holds one —
 * churn to a new slot across retries. Prefer the draft's own slot when it is
 * still safe; otherwise flip to the other slot of the same provider pair.
 */
function pickNonLiveStagingRef(
  id: string,
  current: string | undefined,
  liveRefs: ReadonlySet<string>,
  usedRefs: ReadonlySet<string>,
): string {
  const slotA = stagingSlotA(id)
  const slotB = stagingSlotB(id)
  if (current !== undefined && !liveRefs.has(current) && !usedRefs.has(current)) return current
  if (!liveRefs.has(slotA) && !usedRefs.has(slotA)) return slotA
  if (!liveRefs.has(slotB) && !usedRefs.has(slotB)) return slotB
  // Both slots are somehow claimed; the second is the least-bad orphan risk.
  return slotB
}

/** One provider record as stored (loose, from the wire view). */
function providerRecordOf(view: SettingsSnapshot | undefined, id: string): Record<string, unknown> | undefined {
  const providers = (view?.value?.['providers'] ?? {}) as Record<string, unknown>
  const record = providers[id]
  return typeof record === 'object' && record !== null && !Array.isArray(record) ? record as Record<string, unknown> : undefined
}

/** A credential-ref name a provider references, when one stands. */
function apiKeyEnvOf(view: SettingsSnapshot | undefined, id: string): string | undefined {
  const record = providerRecordOf(view, id)
  const ref = record?.['apiKeyEnv']
  return typeof ref === 'string' && ref.trim().length > 0 ? ref.trim() : undefined
}

/**
 * The image-mind settings controller: reads the namespace through the
 * official wire, stages drafts, and saves as minimal path ops. Uses the
 * legacy gateway only when the official wire is unavailable.
 */
export class ImageMindSettingsStore {
  readonly store: SnapshotStore<ImageMindSettingsState>
  private view: SettingsSnapshot = {
    status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host',
  }
  private credentialState = new Map<string, { configured: boolean; writable: boolean }>()
  private draft = new Map<string, ProviderDraft>()
  private draftTop = new Map<string, string>()
  private saving = false
  private failed = false
  private failedReason: string | undefined
  private generation = 0
  /** The bound settings scope (observable mirror) this store follows. */
  private readonly scope: SettingsScope<Record<string, unknown>> | undefined
  /** Removes the mirror subscription on dispose. */
  private readonly disposeScope: (() => void) | undefined
  private disposed = false

  constructor(private readonly ctx: ImageMindClientContext) {
    this.store = createSnapshotStore(this.projection())
    // Bind the scope ONCE and treat it as an observable mirror, never as a
    // request/response getter: its first snapshot may be `loading`, and the
    // card must follow it into `ready` (and subsequent document/reconnect
    // changes) via subscribe — exactly like the official rc.1 controllers.
    this.scope = resolveScope(ctx)
    if (this.scope === undefined) {
      this.view = { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'legacy' }
      this.publish()
      return
    }
    this.disposeScope = this.scope.subscribe(() => {
      if (!this.disposed) void this.load()
    })
    void this.load()
  }

  /** Drop the mirror subscription; no further loads fire. */
  dispose(): void {
    this.disposed = true
    this.disposeScope?.()
  }

  /** Whether the official settings wire is live for this connection. */
  get transport(): 'official' | 'legacy' | 'unavailable' {
    return this.scope !== undefined ? 'official' : 'unavailable'
  }

  /** Refresh the snapshot from the bound scope mirror. */
  async load(): Promise<void> {
    const generation = ++this.generation
    if (this.scope === undefined) {
      this.view = { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'legacy' }
      this.publish()
      return
    }
    try {
      const next = snapshotFromBoundScope(this.scope)
      if (generation !== this.generation) return
      this.view = next
      // Re-derive drafts that were not staged yet.
      for (const id of Object.keys((next.value?.['providers'] ?? {}) as Record<string, unknown>)) {
        if (!this.draft.has(id)) {
          this.draft.set(id, draftOf(id, providerRecordOf(next, id), this.credentialConfigured(id), this.credentialMask(id)))
        }
      }
      for (const id of [...this.draft.keys()]) {
        if (!Object.hasOwn((next.value?.['providers'] ?? {}) as Record<string, unknown>, id)) this.draft.delete(id)
      }
      this.publish()
    } catch {
      if (generation !== this.generation) return
      this.view = { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'legacy' }
      this.publish()
    }
    // Credential refresh is a SEPARATE concern from the settings scope: a
    // credential describe failure must never demote a healthy settings view
    // to unavailable/read-only. It only clears the status lamps.
    await this.refreshCredentials(generation)
  }

  /** Refresh credential configured-state lamps without touching the settings view. */
  private async refreshCredentials(generation: number): Promise<void> {
    const value = this.view.value
    const providers = (value?.['providers'] ?? {}) as Record<string, unknown>
    const refs = [...new Set(
      (Object.keys(providers))
        .map(id => apiKeyEnvOf(this.view, id))
        .filter((ref): ref is string => ref !== undefined),
    )]
    if (refs.length === 0) {
      this.credentialState = new Map()
      return
    }
    try {
      const states = new Map<string, { configured: boolean; writable: boolean }>()
      for (const ref of refs) {
        states.set(ref, await describeCredentialOfficial(this.ctx, ref))
      }
      if (generation !== this.generation) return
      this.credentialState = states
      this.publish()
    } catch {
      // Keep the previous lamp state; the settings view stays authoritative.
      if (generation !== this.generation) return
    }
  }

  /** Whether a provider's credential ref is configured (credential store). */
  private credentialConfigured(id: string): boolean {
    const ref = apiKeyEnvOf(this.view, id)
    if (ref === undefined) return false
    return this.credentialState.get(ref)?.configured === true
  }

  /** The mask (`*` repeated for the key's length) for a provider's credential. */
  private credentialMask(id: string): string {
    const record = providerRecordOf(this.view, id)
    // Inline legacy key: the host redacts it; the mask length is unknown, so
    // a single placeholder star signals "configured".
    if (record?.['apiKey'] !== undefined) return '*'
    const ref = apiKeyEnvOf(this.view, id)
    if (ref === undefined) return ''
    return this.credentialState.get(ref)?.configured === true ? '*' : ''
  }

  private top(field: string): string {
    return this.draftTop.get(field) ?? topText(this.view.value, field)
  }

  private dirty(): boolean {
    if (this.view.status !== 'ready') return this.draft.size > 0 || this.draftTop.size > 0
    const providers = (this.view.value?.['providers'] ?? {}) as Record<string, unknown>
    const ids = new Set([...Object.keys(providers), ...this.draft.keys()])
    for (const id of ids) {
      const record = providerRecordOf(this.view, id)
      const d = this.draft.get(id)
      if (d === undefined) {
        // Deleted a user-owned provider (present in the raw user layer).
        const userProviders = ((this.view.user as Record<string, unknown> | undefined)?.['providers'] ?? {}) as Record<string, unknown>
        if (Object.hasOwn(userProviders, id)) return true
        continue
      }
      const original = draftOf(id, record, this.credentialConfigured(id), this.credentialMask(id))
      if (original.displayName !== d.displayName || original.baseURL !== d.baseURL || original.model !== d.model
        || original.apiKeyEnv !== d.apiKeyEnv || original.apiStyle !== d.apiStyle
        || original.maxOutputTokens !== d.maxOutputTokens || original.keyless !== d.keyless
        || d.apiKeyText !== original.apiKeyText) return true
    }
    for (const id of this.draft.keys()) {
      if (!Object.hasOwn(providers, id)) return true
    }
    for (const [field, text] of this.draftTop) {
      if (topText(this.view.value, field) !== text) return true
    }
    return false
  }

  private projection(): ImageMindSettingsState {
    const providers = (this.view.value?.['providers'] ?? {}) as Record<string, unknown>
    const ids = [...new Set([...Object.keys(providers), ...this.draft.keys()])]
    const activeNow = this.top('active')
    const rows: ProviderCardState[] = ids
      // Stable order: the active provider first, then configured providers
      // in insertion order, then name — so the list never jumps around.
      .sort((a, b) => {
        const aActive = a === activeNow ? 0 : 1
        const bActive = b === activeNow ? 0 : 1
        if (aActive !== bActive) return aActive - bActive
        return a.localeCompare(b)
      })
      .map(id => {
        const d = this.draft.get(id) ?? draftOf(id, providerRecordOf(this.view, id), this.credentialConfigured(id), this.credentialMask(id))
        const complete = d.baseURL.trim().length > 0 && d.model.trim().length > 0
        // A keyless provider never needs a key; a keyed one needs a
        // resolvable credential. Local endpoint roots default to keyless.
        const keyReady = d.keyless || d.apiKeyMask.length > 0
        return {
          id,
          ...d,
          complete,
          keyReady,
          missingKey: complete && !d.keyless && d.apiKeyMask.length === 0,
        }
      })
    return {
      shell: {
        // The card renders only once the scope mirror is ready — matching the
        // official rc.1 CardForm (a terminal `unavailable` must not paint as
        // an editable-but-readonly card).
        available: this.view.status === 'ready',
        exposed: this.view.status === 'ready',
        writable: this.view.writable,
        dirty: this.dirty(),
        invalid: false,
        saving: this.saving,
        failed: this.failed,
        ...this.failedReason === undefined ? {} : { failedReason: this.failedReason },
      },
      providers: rows,
      active: this.top('active'),
      defaultPrompt: this.top('defaultPrompt'),
      maxBytes: this.top('maxBytes'),
      timeoutMs: this.top('timeoutMs'),
      renderImagePreview: this.top('renderImagePreview'),
      refs: [...new Set(rows.flatMap(row => row.apiKeyEnv.trim().length > 0 ? [row.apiKeyEnv.trim()] : []))],
      transport: this.transport,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /** Stage one text field (every draft field except the keyless boolean). */
  editProvider(id: string, field: Exclude<keyof ProviderDraft, 'keyless'>, text: string): void {
    const current = this.draft.get(id) ?? draftOf(id, providerRecordOf(this.view, id), this.credentialConfigured(id), this.credentialMask(id))
    this.draft.set(id, { ...current, [field]: text })
    this.failed = false
    this.failedReason = undefined
    this.publish()
  }

  /** Stage the keyless fact as a strict boolean (never a string). */
  setProviderKeyless(id: string, value: boolean): void {
    const current = this.draft.get(id) ?? draftOf(id, providerRecordOf(this.view, id), this.credentialConfigured(id), this.credentialMask(id))
    this.draft.set(id, { ...current, keyless: value })
    this.failed = false
    this.failedReason = undefined
    this.publish()
  }

  /** Stage one top-level field. */
  editTop(field: string, text: string): void {
    this.draftTop.set(field, text)
    this.failed = false
    this.failedReason = undefined
    this.publish()
  }

  /**
   * Add a new provider with an EXPLICIT route id — never derived from a
   * display name. Catalog entries pass their stable `entry.id`; custom
   * providers pass the user-typed id (validated). The display name is
   * presentation-only and never becomes the route identity.
   */
  addProvider(options: {
    id: string
    displayName?: string
    preset?: { baseURL: string; model: string; apiKeyEnv: string; apiStyle?: string; keyless?: boolean }
  }): boolean {
    const id = options.id.trim()
    if (!isValidProviderId(id)) return false
    const providers = (this.view.value?.['providers'] ?? {}) as Record<string, unknown>
    if (this.draft.has(id) || Object.hasOwn(providers, id)) return false
    const draft = draftOf(id, undefined, false, '')
    if (options.displayName !== undefined && options.displayName.trim().length > 0) {
      draft.displayName = options.displayName.trim()
    }
    if (options.preset !== undefined) {
      draft.baseURL = options.preset.baseURL
      draft.model = options.preset.model
      draft.apiKeyEnv = options.preset.apiKeyEnv
      if (options.preset.apiStyle !== undefined) draft.apiStyle = options.preset.apiStyle
      draft.keyless = options.preset.keyless === true || isKeylessBaseURL(options.preset.baseURL)
    }
    this.draft.set(id, draft)
    this.failed = false
    this.failedReason = undefined
    this.publish()
    return true
  }

  /** Stage a provider for deletion. */
  deleteProvider(id: string): void {
    this.draft.delete(id)
    if (this.top('active') === id) this.draftTop.set('active', '')
    this.failed = false
    this.failedReason = undefined
    this.publish()
  }

  /** Stage a provider as the active one. */
  setActive(id: string): void {
    this.draftTop.set('active', id)
    this.failed = false
    this.failedReason = undefined
    this.publish()
  }

  /** Drop every staged edit. */
  discard(): void {
    if (!this.dirty() && !this.failed) return
    this.draft.clear()
    this.draftTop.clear()
    this.failed = false
    this.failedReason = undefined
    void this.load()
  }

  /** Compute path ops carrying the staged draft over the loaded view. */
  planOps(): SettingsOp[] {
    const ops: SettingsOp[] = []
    const providers = (this.view.value?.['providers'] ?? {}) as Record<string, unknown>
    const ids = new Set([...Object.keys(providers), ...this.draft.keys()])
    const settingsRefs = new Map<string, string>()

    // The credential plan already resolves staging: every typed key maps to the
    // exact ref the settings commit must reference (derived ref for new
    // providers, stable staging ref when the target is live).
    for (const write of this.stagedCredentialPlan()) {
      settingsRefs.set(write.id, write.settingsRef)
    }

    for (const id of ids) {
      const record = providerRecordOf(this.view, id)
      const d = this.draft.get(id)
      if (d === undefined) {
        ops.push({ op: 'unset', path: ['providers', id] })
        continue
      }
      const original = draftOf(id, record, this.credentialConfigured(id), this.credentialMask(id))
      // Staging wins when a typed key must not overwrite a live credential:
      // the settings commit switches apiKeyEnv to the staging ref atomically.
      const staged = settingsRefs.get(id)
      const effectiveEnv = staged !== undefined ? staged : d.apiKeyEnv.trim()
      if (record === undefined) {
        ops.push({
          op: 'set',
          path: ['providers', id],
          value: {
            ...d.displayName.trim() !== '' && d.displayName.trim() !== id ? { displayName: d.displayName.trim() } : {},
            baseURL: d.baseURL.trim(),
            model: d.model.trim(),
            ...d.apiStyle.trim() !== '' ? { apiStyle: d.apiStyle.trim() } : {},
            ...d.maxOutputTokens.trim() !== '' ? { maxOutputTokens: Number(d.maxOutputTokens.trim()) } : {},
            ...effectiveEnv !== '' ? { apiKeyEnv: effectiveEnv } : {},
            ...d.keyless ? { keyless: true } : {},
          },
        })
        continue
      }
      const setField = (field: string, value: string | number | boolean): void => { ops.push({ op: 'set', path: ['providers', id, field], value }) }
      const unsetField = (field: string): void => { ops.push({ op: 'unset', path: ['providers', id, field] }) }
      if (original.baseURL !== d.baseURL) setField('baseURL', d.baseURL.trim())
      if (original.model !== d.model) setField('model', d.model.trim())
      if (original.apiStyle !== d.apiStyle) d.apiStyle.trim() === '' ? unsetField('apiStyle') : setField('apiStyle', d.apiStyle.trim())
      if (original.maxOutputTokens !== d.maxOutputTokens) {
        d.maxOutputTokens.trim() === '' ? unsetField('maxOutputTokens') : setField('maxOutputTokens', Number(d.maxOutputTokens.trim()))
      }
      if (original.apiKeyEnv !== effectiveEnv) {
        effectiveEnv === '' ? unsetField('apiKeyEnv') : setField('apiKeyEnv', effectiveEnv)
      }
      if (original.displayName !== d.displayName) {
        const next = d.displayName.trim()
        next === '' || next === id ? unsetField('displayName') : setField('displayName', next)
      }
      if (original.keyless !== d.keyless) {
        d.keyless ? setField('keyless', true) : unsetField('keyless')
      }
    }

    const setTop = (field: string, value: string | number | boolean): void => { ops.push({ op: 'set', path: [field], value }) }
    const unsetTop = (field: string): void => { ops.push({ op: 'unset', path: [field] }) }
    const activeNow = topText(this.view.value, 'active')
    const activeNext = this.top('active')
    if (activeNow !== activeNext) activeNext === '' ? unsetTop('active') : setTop('active', activeNext)
    for (const field of ['defaultPrompt', 'maxBytes', 'timeoutMs', 'renderImagePreview'] as const) {
      const now = topText(this.view.value, field)
      const next = this.top(field)
      if (now === next) continue
      if (next === '') { unsetTop(field); continue }
      if (field === 'maxBytes' || field === 'timeoutMs') setTop(field, Number(next))
      else if (field === 'renderImagePreview') setTop(field, next === 'true')
      else setTop(field, next)
    }
    return ops
  }

  /**
   * The credential writes needed when the card saves a typed key, plus the
   * ref the settings mutation must point the provider at. The destination ref
   * is a stable staging ref whenever the target is already referenced by the
   * committed settings: overwriting a live credential before the settings
   * commit would let a CAS conflict pair the old endpoint with the new key.
   */
  stagedCredentialPlan(): Array<{ id: string; ref: string; value: string; settingsRef: string }> {
    // The set of refs the COMMITTED settings currently reference across ALL
    // providers — overwriting any of them before the settings commit would
    // let a CAS conflict pair an unchanged endpoint with a foreign key.
    const liveRefs = new Set<string>()
    const committedProviders = (this.view.value?.['providers'] ?? {}) as Record<string, unknown>
    for (const record of Object.values(committedProviders)) {
      if (typeof record !== 'object' || record === null) continue
      const env = (record as Record<string, unknown>)['apiKeyEnv']
      if (typeof env === 'string' && env.trim().length > 0) liveRefs.add(env.trim())
    }

    const writes: Array<{ id: string; ref: string; value: string; settingsRef: string }> = []
    const usedRefs = new Set<string>()
    for (const [id, draft] of this.draft) {
      if (draft.apiKeyText.length === 0 || /^\*+$/.test(draft.apiKeyText)) continue
      const explicitEnv = draft.apiKeyEnv.trim()
      const baseRef = explicitEnv.length > 0 ? explicitEnv : deriveKeyRef(id)
      const settingsRef = liveRefs.has(baseRef) || usedRefs.has(baseRef)
        ? pickNonLiveStagingRef(id, draft.stagingRef, liveRefs, usedRefs)
        : baseRef
      // Remember the chosen slot on the draft so a retry after a CAS conflict
      // reuses the exact same (still non-live) staging ref instead of churning.
      if (settingsRef !== draft.stagingRef) this.draft.set(id, { ...draft, stagingRef: settingsRef })
      usedRefs.add(settingsRef)
      writes.push({ id, ref: settingsRef, value: draft.apiKeyText, settingsRef })
    }
    return writes
  }

  /** The credential refs that need storing when the card saves a typed key. */
  pendingCredentialWrites(): Array<{ id: string; ref: string; value: string }> {
    return this.stagedCredentialPlan().map(({ id, ref, value }) => ({ id, ref, value }))
  }

  /** Save staged drafts with a fail-safe ordering: credentials first, the
   * single settings commit last. A credential write failure leaves settings
   * untouched (the orphaned secret is safe residue, never a half-published
   * active config); a settings CAS conflict leaves credentials written but
   * un-referenced, and a retry converges. */
  async save(): Promise<void> {
    if (this.saving || !this.dirty()) return
    if (this.scope === undefined) {
      this.failed = true
      this.failedReason = '当前环境不支持官方设置通道'
      this.publish()
      return
    }
    const ops = this.planOps()
    const credentialWrites = this.pendingCredentialWrites()
    if (ops.length === 0 && credentialWrites.length === 0) return
    this.saving = true
    this.failed = false
    this.failedReason = undefined
    this.publish()
    try {
      // Phase 1 — credentials. A failure here leaves settings untouched.
      for (const write of credentialWrites) {
        await setCredentialOfficial(this.ctx, write.ref, write.value)
      }
      // Phase 2 — the single settings commit (planOps already embeds any
      // derived apiKeyEnv refs, so one revision transition is enough).
      if (ops.length > 0) {
        this.view = await writeThroughScope(this.scope, ops, this.view.revision)
      }
      this.draft.clear()
      this.draftTop.clear()
      await this.load()
    } catch (error) {
      // Partial state is safe by construction: either credentials exist
      // un-referenced (retry converges) or settings stayed old. Drafts remain
      // dirty so the user can retry.
      this.failed = true
      this.failedReason = (error as Error).message
    } finally {
      this.saving = false
      this.publish()
    }
  }
}
