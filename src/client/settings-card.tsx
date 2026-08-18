/**
 * The image-mind settings card, mirroring the built-in Models page layout:
 * two add buttons on top ("添加提供方" from the official directory, "添加自
 * 定义提供方" as a blank card), a list of provider rows below (name + a REAL
 * status lamp + 编辑/删除/设为默认), and one editor card at a time — clicking
 * 编辑 opens that provider's editor (endpoint, model, key, protocol, limits).
 *
 * The status lamp is truthful: it reflects the configuration as stored —
 * green only when the provider is complete AND its key actually resolves
 * (inline or through the env seam); red when the key is missing or the entry
 * is incomplete. A connection test overrides the lamp only while/after it
 * actually runs — an untested provider never shows "已连接".
 *
 * Registers into the official `settings.plugin.item` slot (设置 → 插件 → 插件
 * 配置) and reads/writes the `image-mind` section through the plugin's own
 * `/image-mind/config` gateway.
 * @module dsh-plugin-image-mind/client/settings_card
 */

import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { useEffect, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SettingsCard, BooleanField, ChoiceField, ModelField, ValueField, type CardStatus } from './card-ui.tsx'
import {
  loadCatalog, listModels, testConnection,
  type ConfigOp, type ConfigView, type ProviderView, type TestOverrides, type VisionProviderCatalogEntry,
} from './config-client.ts'
import type { CardShell } from './card-form.ts'
import { RemoteConfigScope } from './remote-scope.ts'
import { showToast } from './toast.ts'
import { t, type CardKey } from './locales.ts'

/** One provider as the card edits it (all string drafts; secret kept write-only). */
export interface ProviderDraft {
  baseURL: string
  model: string
  apiKeyEnv: string
  apiStyle: string
  maxOutputTokens: string
  /** The API key input: '' (untouched), a mask, or a newly-typed inline key. */
  apiKeyText: string
  apiKeyConfigured: boolean
  apiKeyMask: string
}

/** One provider row the renderer consumes. */
export interface ProviderCardState extends ProviderDraft {
  id: string
  /** endpoint+model filled (regardless of key). */
  complete: boolean
  /** a key actually resolves today (inline or env seam). */
  keyReady: boolean
}

/** The whole image-mind card state the renderer consumes. */
export interface ImageMindSettingsCardState {
  shell: CardShell
  providers: ProviderCardState[]
  active: string
  defaultPrompt: string
  maxBytes: string
  timeoutMs: string
  renderImagePreview: string
}

/** The registration-side face the card's slot entry injects. */
export interface ImageMindSettingsCardFace {
  hooks: {
    imageMindSettingsCard: SnapshotStore<ImageMindSettingsCardState>
  }
  save: () => void
  discard: () => void
  editProvider: (id: string, field: keyof ProviderDraft, text: string) => void
  editTop: (field: string, text: string) => void
  addProvider: (name: string, preset?: { baseURL: string; model: string; apiKeyEnv: string }) => boolean
  deleteProvider: (id: string) => void
  setActive: (id: string) => void
}

/** A provider id, normalized from a user-entered name (trim, no spaces). */
function normalizeId(name: string): string {
  return name.trim().replace(/\s+/g, '-')
}

/** Read one top-level string field from a config view. */
function topText(view: ConfigView | undefined, field: string): string {
  const value = view?.value as Record<string, unknown> | undefined
  const raw = value?.[field]
  if (raw === undefined || raw === null) return ''
  return typeof raw === 'string' ? raw : String(raw)
}

/** Build a draft provider from a loaded ProviderView (or a blank one). */
function draftOf(id: string, view: ProviderView | undefined): ProviderDraft {
  return {
    baseURL: view?.baseURL ?? '',
    model: view?.model ?? '',
    apiKeyEnv: view?.apiKeyEnv ?? '',
    apiStyle: view?.apiStyle ?? 'chat-completions',
    maxOutputTokens: view?.maxOutputTokens !== undefined ? String(view.maxOutputTokens) : '1024',
    apiKeyText: view?.apiKeyMask ?? '',
    apiKeyConfigured: view?.apiKeyConfigured ?? false,
    apiKeyMask: view?.apiKeyMask ?? '',
  }
}

/** Bridge the config gateway onto a staged multi-provider form. */
export class ImageMindSettingsCardController {
  private readonly store: SnapshotStore<ImageMindSettingsCardState>
  private view: ConfigView | undefined
  private draft = new Map<string, ProviderDraft>()
  private draftTop = new Map<string, string>()
  private saving = false
  private failed = false
  private failedReason: string | undefined

  /** @param scope - the remote settings scope for the `image-mind` namespace. */
  constructor(private readonly scope: RemoteConfigScope) {
    this.store = createSnapshotStore(this.projection())
    this.scope.subscribe(() => this.onScopeChange())
    this.onScopeChange()
  }

  private onScopeChange(): void {
    const snap = this.scope.getSnapshot()
    if (snap.status !== 'ready') {
      this.publish()
      return
    }
    const value = (snap.value ?? {}) as ConfigView['value']
    this.view = {
      revision: snap.revision ?? 0,
      value,
      base: snap.base,
      user: snap.user,
      writable: snap.writable,
    }
    const providers = value.providers ?? {}
    for (const [id, pv] of Object.entries(providers)) {
      if (!this.draft.has(id)) this.draft.set(id, draftOf(id, pv))
    }
    for (const id of [...this.draft.keys()]) {
      if (!Object.hasOwn(providers, id)) this.draft.delete(id)
    }
    this.publish()
  }

  private topText(field: string): string {
    return this.draftTop.get(field) ?? topText(this.view, field)
  }

  private fieldShell(): CardShell {
    const snap = this.scope.getSnapshot()
    return {
      available: snap.status !== 'loading',
      exposed: snap.status === 'ready',
      writable: snap.writable,
      dirty: this.dirty(),
      invalid: false,
      saving: this.saving,
      failed: this.failed,
      ...this.failedReason === undefined ? {} : { failedReason: this.failedReason },
    }
  }

  private dirty(): boolean {
    if (this.view === undefined) return this.draft.size > 0 || this.draftTop.size > 0
    const providers = this.view.value.providers ?? {}
    const ids = new Set([...Object.keys(providers), ...this.draft.keys()])
    for (const id of ids) {
      const pv = providers[id]
      const d = this.draft.get(id)
      if (d === undefined) {
        // Deleted a user-owned provider.
        if (this.view.user !== undefined) {
          const userProviders = ((this.view.user as Record<string, unknown>)['providers'] ?? {}) as Record<string, unknown>
          if (Object.hasOwn(userProviders, id)) return true
        }
        continue
      }
      const original = draftOf(id, pv)
      if (original.baseURL !== d.baseURL || original.model !== d.model || original.apiKeyEnv !== d.apiKeyEnv
        || original.apiStyle !== d.apiStyle || original.maxOutputTokens !== d.maxOutputTokens
        || d.apiKeyText !== original.apiKeyText) return true
    }
    for (const id of this.draft.keys()) {
      if (!Object.hasOwn(providers, id)) return true
    }
    for (const [field, text] of this.draftTop) {
      if (topText(this.view, field) !== text) return true
    }
    return false
  }

  private projection(): ImageMindSettingsCardState {
    const providers = this.view?.value.providers ?? {}
    const ids = [...new Set([...Object.keys(providers), ...this.draft.keys()])]
    const rows: ProviderCardState[] = ids.map(id => {
      const d = this.draft.get(id) ?? draftOf(id, providers[id])
      return {
        id,
        ...d,
        complete: d.baseURL.trim().length > 0 && d.model.trim().length > 0,
        keyReady: d.apiKeyMask.length > 0,
      }
    })
    return {
      shell: this.fieldShell(),
      providers: rows,
      active: this.topText('active'),
      defaultPrompt: this.topText('defaultPrompt'),
      maxBytes: this.topText('maxBytes'),
      timeoutMs: this.topText('timeoutMs'),
      renderImagePreview: this.topText('renderImagePreview'),
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /** Stage one provider field. */
  editProvider(id: string, field: keyof ProviderDraft, text: string): void {
    const providers = this.view?.value.providers ?? {}
    const current = this.draft.get(id) ?? draftOf(id, providers[id])
    this.draft.set(id, { ...current, [field]: text })
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

  /** Add a new provider: from the catalog (preset) or a blank custom card. */
  addProvider(name: string, preset?: { baseURL: string; model: string; apiKeyEnv: string }): boolean {
    const id = normalizeId(name)
    if (id.length === 0) {
      showToast(t('provider.needName'), 'error')
      return false
    }
    if (this.draft.has(id) || Object.hasOwn(this.view?.value.providers ?? {}, id)) {
      showToast(t('provider.duplicate'), 'error')
      return false
    }
    const draft = draftOf(id, undefined)
    if (preset !== undefined) {
      draft.baseURL = preset.baseURL
      draft.model = preset.model
      draft.apiKeyEnv = preset.apiKeyEnv
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
    if (this.topText('active') === id) this.draftTop.set('active', '')
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

  /** Build the write faces the card's slot registration injects. */
  inject(): ImageMindSettingsCardFace {
    return {
      hooks: { imageMindSettingsCard: this.store },
      save: () => { void this.save() },
      discard: this.discard.bind(this),
      editProvider: this.editProvider.bind(this),
      editTop: this.editTop.bind(this),
      addProvider: this.addProvider.bind(this),
      deleteProvider: this.deleteProvider.bind(this),
      setActive: this.setActive.bind(this),
    }
  }

  private discard(): void {
    if (!this.dirty() && !this.failed) return
    this.draft.clear()
    this.draftTop.clear()
    this.failed = false
    this.failedReason = undefined
    this.onScopeChange()
  }

  /** Compute path ops carrying the staged draft over the loaded view. */
  private planOps(): ConfigOp[] {
    const ops: ConfigOp[] = []
    const providers = this.view?.value.providers ?? {}
    const ids = new Set([...Object.keys(providers), ...this.draft.keys()])

    for (const id of ids) {
      const pv = providers[id]
      const d = this.draft.get(id)
      if (d === undefined) {
        ops.push({ op: 'unset', path: ['providers', id] })
        continue
      }
      const original = draftOf(id, pv)
      if (pv === undefined) {
        ops.push({
          op: 'set',
          path: ['providers', id],
          value: {
            baseURL: d.baseURL.trim(),
            model: d.model.trim(),
            ...d.apiStyle.trim() !== '' ? { apiStyle: d.apiStyle.trim() } : {},
            ...d.maxOutputTokens.trim() !== '' ? { maxOutputTokens: Number(d.maxOutputTokens.trim()) } : {},
            ...d.apiKeyEnv.trim() !== '' ? { apiKeyEnv: d.apiKeyEnv.trim() } : {},
          },
        })
        if (d.apiKeyText !== '' && d.apiKeyText !== d.apiKeyMask) {
          ops.push({ op: 'set', path: ['providers', id, 'apiKey'], value: d.apiKeyText })
        }
        continue
      }
      const setField = (field: string, value: unknown): void => {
        ops.push({ op: 'set', path: ['providers', id, field], value })
      }
      const unsetField = (field: string): void => {
        ops.push({ op: 'unset', path: ['providers', id, field] })
      }
      if (original.baseURL !== d.baseURL) setField('baseURL', d.baseURL.trim())
      if (original.model !== d.model) setField('model', d.model.trim())
      if (original.apiStyle !== d.apiStyle) d.apiStyle.trim() === '' ? unsetField('apiStyle') : setField('apiStyle', d.apiStyle.trim())
      if (original.maxOutputTokens !== d.maxOutputTokens) {
        d.maxOutputTokens.trim() === '' ? unsetField('maxOutputTokens') : setField('maxOutputTokens', Number(d.maxOutputTokens.trim()))
      }
      if (original.apiKeyEnv !== d.apiKeyEnv) d.apiKeyEnv.trim() === '' ? unsetField('apiKeyEnv') : setField('apiKeyEnv', d.apiKeyEnv.trim())
      if (d.apiKeyText !== '' && d.apiKeyText !== d.apiKeyMask) {
        setField('apiKey', d.apiKeyText)
      } else if (d.apiKeyText === '' && d.apiKeyConfigured) {
        unsetField('apiKey')
      }
    }

    const setTop = (field: string, value: unknown): void => { ops.push({ op: 'set', path: [field], value }) }
    const unsetTop = (field: string): void => { ops.push({ op: 'unset', path: [field] }) }
    const activeNow = topText(this.view, 'active')
    const activeNext = this.topText('active')
    if (activeNow !== activeNext) activeNext === '' ? unsetTop('active') : setTop('active', activeNext)
    for (const field of ['defaultPrompt', 'maxBytes', 'timeoutMs', 'renderImagePreview'] as const) {
      const now = topText(this.view, field)
      const next = this.topText(field)
      if (now === next) continue
      if (next === '') { unsetTop(field); continue }
      if (field === 'maxBytes' || field === 'timeoutMs') setTop(field, Number(next))
      else if (field === 'renderImagePreview') setTop(field, next === 'true')
      else setTop(field, next)
    }
    return ops
  }

  private async save(): Promise<void> {
    if (this.saving || !this.dirty()) return
    const ops = this.planOps()
    if (ops.length === 0) return
    this.saving = true
    this.failed = false
    this.failedReason = undefined
    this.publish()
    try {
      await this.scope.mutate(ops)
      this.draft.clear()
      this.draftTop.clear()
      this.onScopeChange()
    } catch (error) {
      this.failed = true
      this.failedReason = (error as Error).message
    } finally {
      this.saving = false
      this.publish()
    }
  }
}

/** Props the renderer binds for the image-mind card. */
export type ImageMindSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<ImageMindSettingsCardFace>

/** One provider's transient connection-test state. */
interface ProviderTest {
  status: CardStatus
  label: string
  text?: string
}

/**
 * Render the image-mind card.
 * @param props - the card snapshot and its form actions.
 * @returns the card.
 */
export function ImageMindSettingsCard(props: ImageMindSettingsCardProps) {
  const state = props.useImageMindSettingsCard(snapshot => snapshot)
  const disabled = !state.shell.writable
  // One editor at a time, like the built-in Models page.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addMode, setAddMode] = useState<'none' | 'catalog' | 'custom'>('none')
  const [catalog, setCatalog] = useState<VisionProviderCatalogEntry[]>([])
  const [customName, setCustomName] = useState('')
  const [tests, setTests] = useState<Record<string, ProviderTest>>({})
  const [modelsBy, setModelsBy] = useState<Record<string, { loading: boolean; candidates: string[]; note: string }>>({})

  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }

  const providerOverrides = (p: ProviderCardState): TestOverrides => ({
    baseURL: p.baseURL.trim().length > 0 ? p.baseURL.trim() : undefined,
    model: p.model.trim().length > 0 ? p.model.trim() : undefined,
    apiKeyEnv: p.apiKeyEnv.trim().length > 0 ? p.apiKeyEnv.trim() : undefined,
    apiStyle: p.apiStyle.trim().length > 0 ? p.apiStyle.trim() : undefined,
    maxOutputTokens: p.maxOutputTokens.trim().length > 0 ? Number(p.maxOutputTokens.trim()) : undefined,
  })

  const runTest = async (p: ProviderCardState): Promise<void> => {
    const current = tests[p.id]
    if (current?.status === 'testing') return
    setTests(prev => ({ ...prev, [p.id]: { status: 'testing', label: t('provider.testing') } }))
    const overrides = providerOverrides(p)
    if (p.apiKeyText.length > 0 && !/^\*+$/.test(p.apiKeyText)) overrides.apiKey = p.apiKeyText
    const outcome = await testConnection(overrides)
    setTests(prev => ({
      ...prev,
      [p.id]: outcome.ok
        ? { status: 'ok', label: t('provider.ok'), text: `${t('test.success')} ${outcome.text}` }
        : { status: 'fail', label: t('provider.fail'), text: `${t('test.failure')} ${outcome.message}` },
    }))
  }

  const loadModels = async (p: ProviderCardState, keyOverride?: string): Promise<void> => {
    const current = modelsBy[p.id]
    if (current?.loading) return
    setModelsBy(prev => ({ ...prev, [p.id]: { loading: true, candidates: [], note: '' } }))
    const overrides = providerOverrides(p)
    const key = keyOverride !== undefined ? keyOverride : p.apiKeyText
    if (key.length > 0 && !/^\*+$/.test(key)) overrides.apiKey = key
    const outcome = await listModels(overrides)
    if (outcome.ok) {
      setModelsBy(prev => ({
        ...prev,
        [p.id]: {
          loading: false,
          candidates: outcome.models,
          note: outcome.source === 'fallback' && outcome.reason !== undefined ? `${t('model.fallbackNote')}（${outcome.reason}）` : '',
        },
      }))
    } else {
      setModelsBy(prev => ({ ...prev, [p.id]: { loading: false, candidates: [], note: outcome.message } }))
    }
  }

  // Auto-load the model list once when an editor opens and the provider can
  // already authenticate (key ready or keyless localhost): the user fills the
  // key, opens the editor, and the picker is already populated. Only fires on
  // an editor open with no prior load, so re-renders never refetch.
  useEffect(() => {
    if (editingId === null) return
    const p = state.providers.find(row => row.id === editingId)
    if (p === undefined) return
    const models = modelsBy[p.id]
    if (models !== undefined && (models.loading || models.candidates.length > 0 || models.note !== '')) return
    if (p.baseURL.trim().length === 0) return
    if (!p.keyReady && p.apiKeyText.length === 0) return
    void loadModels(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const openCatalog = async (): Promise<void> => {
    setAddMode('catalog')
    if (catalog.length === 0) {
      const outcome = await loadCatalog()
      if (outcome.ok) setCatalog(outcome.catalog)
      else showToast(outcome.message, 'error')
    }
  }

  const pickFromCatalog = (entry: VisionProviderCatalogEntry): void => {
    if (props.addProvider(entry.name, { baseURL: entry.baseURL, model: entry.defaultModel, apiKeyEnv: entry.apiKeyEnv })) {
      setAddMode('none')
      setEditingId(entry.id)
      showToast(t('provider.added'))
    }
  }

  const addCustom = (): void => {
    if (props.addProvider(customName)) {
      setAddMode('none')
      setCustomName('')
      setEditingId(normalizeId(customName))
      showToast(t('provider.added'))
    }
  }

  const deleteProvider = (id: string): void => {
    if (!window.confirm(t('provider.deleteBody'))) return
    props.deleteProvider(id)
    setEditingId(null)
    showToast(t('provider.deleted'))
  }

  return (
    <SettingsCard
      t={(key) => t(key as CardKey)}
      titleKey="card.title"
      descriptionKey="card.description"
      state={state.shell}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {/* Add row, mirroring the Models page top actions. */}
      <div className="image-mind-card-addrow">
        <button type="button" className="image-mind-card-addbtn" disabled={disabled} onClick={() => { void openCatalog() }}>
          {t('provider.fromCatalog')}
        </button>
        <button type="button" className="image-mind-card-addbtn" disabled={disabled} onClick={() => { setAddMode(addMode === 'custom' ? 'none' : 'custom') }}>
          {t('provider.custom')}
        </button>
      </div>

      {addMode === 'catalog'
        ? (
          <div className="image-mind-card-catalog">
            <p className="image-mind-card-hint">{t('provider.directory')}</p>
            <ul className="image-mind-card-catalog-list">
              {catalog.map(entry => (
                <li key={entry.id}>
                  <button type="button" className="image-mind-card-catalog-item" disabled={disabled} onClick={() => { pickFromCatalog(entry) }}>
                    <span className="image-mind-card-catalog-name">{entry.name}</span>
                    <span className="image-mind-card-catalog-meta">{entry.defaultModel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
        : null}

      {addMode === 'custom'
        ? (
          <div className="image-mind-card-customrow">
            <input
              className="image-mind-card-input"
              placeholder={t('provider.customName')}
              value={customName}
              disabled={disabled}
              onChange={(event) => { setCustomName(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') addCustom() }}
            />
            <button type="button" className="image-mind-card-test" disabled={disabled} onClick={addCustom}>
              {t('provider.save')}
            </button>
          </div>
        )
        : null}

      {/* Provider rows. */}
      {state.providers.length === 0
        ? <p className="image-mind-card-hint">{t('provider.noProviders')}</p>
        : null}
      <ul className="image-mind-card-providerlist">
        {state.providers.map(p => {
          const test = tests[p.id]
          // Truthful lamp: config state by default; test overrides it only
          // after a real test ran (or is running).
          const lamp: CardStatus = test?.status ?? (p.complete ? (p.keyReady ? 'ok' : 'fail') : 'fail')
          const lampLabel = test?.label ?? (p.complete ? (p.keyReady ? t('provider.ready') : t('provider.missingKey')) : t('provider.notReady'))
          return (
            <li key={p.id} className="image-mind-provider-row">
              <button type="button" className="image-mind-provider-row-main" onClick={() => { setEditingId(editingId === p.id ? null : p.id) }} aria-expanded={editingId === p.id}>
                <span className={`image-mind-card-status image-mind-card-status-${lamp}`}>
                  <span className="image-mind-card-status-dot" />
                </span>
                <span className="image-mind-provider-row-name">{p.id}</span>
                {state.active === p.id
                  ? <span className="image-mind-card-badge">{t('provider.active')}</span>
                  : null}
                <span className="image-mind-provider-row-lamp">{lampLabel}</span>
              </button>
              <div className="image-mind-provider-row-actions">
                {state.active !== p.id
                  ? <button type="button" className="image-mind-provider-action" disabled={disabled || !p.complete || !p.keyReady} onClick={() => { props.setActive(p.id) }}>{t('provider.setAsActive')}</button>
                  : null}
                <button type="button" className="image-mind-provider-action" disabled={disabled} onClick={() => { setEditingId(editingId === p.id ? null : p.id) }}>{t('provider.edit')}</button>
                <button type="button" className="image-mind-provider-action image-mind-provider-del" disabled={disabled} onClick={() => { deleteProvider(p.id) }}>{t('provider.delete')}</button>
              </div>
            </li>
          )
        })}
      </ul>

      {/* One editor at a time. */}
      {editingId !== null
        ? (() => {
          const p = state.providers.find(row => row.id === editingId)
          if (p === undefined) return null
          const test = tests[p.id]
          const models = modelsBy[p.id]
          return (
            <div className="image-mind-provider-editor">
              <div className="image-mind-provider-editor-head">
                <span className="image-mind-provider-editor-title">{p.id}</span>
                <button type="button" className="image-mind-provider-action" onClick={() => { setEditingId(null) }}>{t('provider.done')}</button>
              </div>
              <ValueField
                id={`image-mind-${p.id}-baseurl`}
                label={t('field.baseURL')}
                hint={t('field.baseURL.hint')}
                placeholder="https://api.example.com/v1"
                {...fieldProps}
                text={p.baseURL}
                overridden={false}
                invalid={false}
                onEdit={(text) => { props.editProvider(p.id, 'baseURL', text) }}
                onReset={() => { props.editProvider(p.id, 'baseURL', '') }}
              />
              <ModelField
                id={`image-mind-${p.id}-model`}
                label={t('field.model')}
                hint={t('field.model.hint')}
                candidates={models?.candidates ?? []}
                loading={models?.loading ?? false}
                listNote={models?.note ?? ''}
                verified={false}
                verifiedLabel={t('model.verified')}
                loadLabel={t('model.load')}
                loadingLabel={t('model.loading')}
                {...fieldProps}
                text={p.model}
                overridden={false}
                invalid={false}
                onEdit={(text) => { props.editProvider(p.id, 'model', text) }}
                onReset={() => { props.editProvider(p.id, 'model', '') }}
                onLoad={() => { void loadModels(p) }}
              />
              <ChoiceField
                id={`image-mind-${p.id}-apistyle`}
                label={t('field.apiStyle')}
                hint={t('field.apiStyle.hint')}
                inheritLabel={t('settings.inherit')}
                choices={[
                  { value: 'chat-completions', label: t('field.apiStyle.chatCompletions') },
                  { value: 'responses', label: t('field.apiStyle.responses') },
                ]}
                {...fieldProps}
                text={p.apiStyle}
                overridden={false}
                invalid={false}
                onEdit={(text) => { props.editProvider(p.id, 'apiStyle', text) }}
                onReset={() => { props.editProvider(p.id, 'apiStyle', '') }}
              />
              <ValueField
                id={`image-mind-${p.id}-apikey`}
                label={t('field.apiKey')}
                hint={t('field.apiKey.hint')}
                {...fieldProps}
                text={p.apiKeyText}
                overridden={p.apiKeyConfigured}
                invalid={false}
                onEdit={(text) => {
                  props.editProvider(p.id, 'apiKeyText', text)
                  // A freshly typed key unlocks the model list: fetch it right
                  // away so the user only needs to fill the key, then pick a
                  // model. Masks and empty input never trigger a fetch.
                  if (p.baseURL.trim().length > 0 && text.length > 0 && !/^\*+$/.test(text)) {
                    void loadModels({ ...p, apiKeyText: text }, text)
                  }
                }}
                onReset={() => { props.editProvider(p.id, 'apiKeyText', '') }}
              />
              <ValueField
                id={`image-mind-${p.id}-apikeyenv`}
                label={t('field.apiKeyEnv')}
                hint={t('field.apiKeyEnv.hint.multi')}
                {...fieldProps}
                text={p.apiKeyEnv}
                overridden={false}
                invalid={false}
                onEdit={(text) => { props.editProvider(p.id, 'apiKeyEnv', text) }}
                onReset={() => { props.editProvider(p.id, 'apiKeyEnv', '') }}
              />
              <ValueField
                id={`image-mind-${p.id}-maxoutputtokens`}
                label={t('field.maxOutputTokens')}
                hint={t('field.maxOutputTokens.hint')}
                numeric
                {...fieldProps}
                text={p.maxOutputTokens}
                overridden={false}
                invalid={false}
                onEdit={(text) => { props.editProvider(p.id, 'maxOutputTokens', text) }}
                onReset={() => { props.editProvider(p.id, 'maxOutputTokens', '') }}
              />
              <div className="image-mind-card-testrow">
                {test?.text !== undefined
                  ? <p className={test.status === 'ok' ? 'image-mind-card-test-ok' : 'image-mind-card-test-err'} role="status">{test.text}</p>
                  : null}
                <button type="button" className="image-mind-card-test" disabled={disabled} onClick={() => { void runTest(p) }}>
                  {test?.status === 'testing' ? t('test.running') : t('test.run')}
                </button>
              </div>
            </div>
          )
        })()
        : null}

      {/* Global fields. */}
      <ValueField
        id="image-mind-defaultprompt"
        label={t('field.defaultPrompt')}
        hint={t('field.defaultPrompt.hint')}
        {...fieldProps}
        text={state.defaultPrompt}
        overridden={false}
        invalid={false}
        onEdit={(text) => { props.editTop('defaultPrompt', text) }}
        onReset={() => { props.editTop('defaultPrompt', '') }}
      />
      <ValueField
        id="image-mind-maxbytes"
        label={t('field.maxBytes')}
        hint={t('field.maxBytes.hint')}
        numeric
        {...fieldProps}
        text={state.maxBytes}
        overridden={false}
        invalid={false}
        onEdit={(text) => { props.editTop('maxBytes', text) }}
        onReset={() => { props.editTop('maxBytes', '') }}
      />
      <ValueField
        id="image-mind-timeoutms"
        label={t('field.timeoutMs')}
        hint={t('field.timeoutMs.hint')}
        numeric
        {...fieldProps}
        text={state.timeoutMs}
        overridden={false}
        invalid={false}
        onEdit={(text) => { props.editTop('timeoutMs', text) }}
        onReset={() => { props.editTop('timeoutMs', '') }}
      />
      <BooleanField
        id="image-mind-render-preview"
        label={t('field.renderImagePreview')}
        hint={t('field.renderImagePreview.hint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        text={state.renderImagePreview}
        overridden={false}
        invalid={false}
        onEdit={(text) => { props.editTop('renderImagePreview', text) }}
        onReset={() => { props.editTop('renderImagePreview', '') }}
      />
    </SettingsCard>
  )
}
