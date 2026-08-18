/**
 * The image-mind settings card, mirroring the built-in Models page layout:
 * two add buttons on top ("添加提供方" from the official directory, "添加自
 * 定义提供方" as a blank card), a list of provider rows below (name + a REAL
 * status lamp + 编辑/删除/设为默认), and one editor card at a time — clicking
 * 编辑 opens that provider's editor (endpoint, model, key, protocol, limits).
 *
 * The status lamp is truthful: it reflects the configuration as stored —
 * green only when the provider is complete AND its key actually resolves
 * (credential store or env seam); red when the key is missing or the entry
 * is incomplete. A connection test overrides the lamp only while/after it
 * actually runs — an untested provider never shows "已连接".
 *
 * Registers into the official `settings.plugin.item` slot (设置 → 插件 → 插件
 * 配置) and reads/writes the `image-mind` section through the OFFICIAL
 * settings seam (`connection.api.settings` describe/mutate); typed keys go
 * into the credential store through `connection.api.credentials.set`, never
 * into `settings.yaml`.
 * @module dsh-plugin-image-mind/client/settings_card
 */

import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { useEffect, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SettingsCard, BooleanField, ChoiceField, ModelField, ValueField, type CardStatus } from './card-ui.tsx'
import type { CardShell } from './card-form.ts'
import { showToast } from './toast.ts'
import { t, type CardKey } from './locales.ts'
import { setPreviewToggle } from './index.ts'
import {
  ImageMindSettingsStore, deriveKeyRef, normalizeId, topText,
  type ProviderCardState, type ProviderDraft,
} from './settings/store.ts'

/** The whole image-mind card state the renderer consumes. */
export interface ImageMindSettingsCardState {
  shell: CardShell
  providers: ProviderCardState[]
  active: string
  defaultPrompt: string
  maxBytes: string
  timeoutMs: string
  renderImagePreview: string
  transport: 'official' | 'legacy' | 'unavailable'
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

/** Bridge the official settings seam onto a staged multi-provider form. */
export class ImageMindSettingsCardController {
  private readonly store: SnapshotStore<ImageMindSettingsCardState>
  private readonly host: ImageMindSettingsStore | undefined

  /** @param ctx - the slots-injected client context (carries the connection). */
  constructor(ctx: ClientContext) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection = ctx.get('connection') as any
    this.store = createSnapshotStore<ImageMindSettingsCardState>({
      shell: { available: false, exposed: false, writable: false, dirty: false, invalid: false, saving: false, failed: false },
      providers: [],
      active: '',
      defaultPrompt: '',
      maxBytes: '',
      timeoutMs: '',
      renderImagePreview: '',
      transport: connection !== undefined ? 'official' : 'unavailable',
    })
    this.host = connection !== undefined
      ? new ImageMindSettingsStore(connection)
      : undefined
    if (this.host !== undefined) {
      this.host.store.subscribe(() => {
        // Mirror the preview toggle into the module cache the enhancer reads.
        const state = this.host?.store.getSnapshot()
        if (state !== undefined && state.shell.exposed) {
          setPreviewToggle(state.renderImagePreview !== 'false')
        }
        this.publish()
      })
    }
  }

  private publish(): void {
    if (this.host === undefined) return
    const state = this.host.store.getSnapshot()
    const card: ImageMindSettingsCardState = {
      shell: state.shell,
      providers: state.providers,
      active: state.active,
      defaultPrompt: state.defaultPrompt,
      maxBytes: state.maxBytes,
      timeoutMs: state.timeoutMs,
      renderImagePreview: state.renderImagePreview,
      transport: state.transport,
    }
    this.store.set(card)
  }

  /** Build the write faces the card's slot registration injects. */
  inject(): ImageMindSettingsCardFace {
    return {
      hooks: { imageMindSettingsCard: this.store },
      save: () => { void this.save() },
      discard: () => { this.host?.discard() },
      editProvider: (id, field, text) => { this.host?.editProvider(id, field, text) },
      editTop: (field, text) => { this.host?.editTop(field, text) },
      addProvider: (name, preset) => this.host?.addProvider(name, preset) ?? false,
      deleteProvider: (id) => { this.host?.deleteProvider(id) },
      setActive: (id) => { this.host?.setActive(id) },
    }
  }

  private async save(): Promise<void> {
    await this.host?.save()
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

/** Outcome of one connection test against the host vision RPC. */
type TestOutcome = { ok: true; text: string } | { ok: false; message: string }

/** Outcome of one model-list request against the host vision RPC. */
type ModelsOutcome = { ok: true; models: string[]; source: 'endpoint' | 'fallback'; reason?: string } | { ok: false; message: string }

/** The vision RPC endpoints (thin transport; the host does the real work). */
const TEST_ENDPOINT = '/image-mind/test'
const MODELS_ENDPOINT = '/image-mind/models'
const CATALOG_ENDPOINT = '/image-mind/catalog'

/** One official vision provider the "添加提供方" flow offers. */
export interface VisionProviderCatalogEntry {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  apiKeyEnv: string
}

/** Ask the host to run one real vision call with the given draft overrides. */
async function testConnection(overrides: Record<string, unknown>): Promise<TestOutcome> {
  let response: Response
  try {
    response = await fetch(TEST_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides),
    })
  } catch {
    return { ok: false, message: '网络错误：无法连接本机服务' }
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    return { ok: false, message: '本机服务返回了无法解析的响应' }
  }
  const record = envelope as { ok?: unknown; value?: { text?: unknown }; error?: { message?: unknown } } | null
  if (typeof record !== 'object' || record === null) return { ok: false, message: '本机服务响应异常' }
  if (record.ok === true && typeof record.value?.text === 'string') {
    return { ok: true, text: record.value.text }
  }
  const message = record.error?.message
  return { ok: false, message: typeof message === 'string' && message !== '' ? message : `测试失败（HTTP ${response.status}）` }
}

/** Ask the host to list model ids for the current endpoint (draft values may override). */
async function listModels(overrides: Record<string, unknown>): Promise<ModelsOutcome> {
  let response: Response
  try {
    response = await fetch(MODELS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides),
    })
  } catch {
    return { ok: false, message: '网络错误：无法连接本机服务' }
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    return { ok: false, message: '本机服务返回了无法解析的响应' }
  }
  const record = envelope as { ok?: unknown; value?: unknown; error?: { message?: unknown } } | null
  if (typeof record !== 'object' || record === null) return { ok: false, message: '本机服务响应异常' }
  if (record.ok === true && typeof record.value === 'object' && record.value !== null) {
    const value = record.value as { models?: unknown; source?: unknown; reason?: unknown }
    if (Array.isArray(value.models)) {
      return {
        ok: true,
        models: value.models.filter((m): m is string => typeof m === 'string' && m !== ''),
        source: value.source === 'endpoint' ? 'endpoint' : 'fallback',
        ...typeof value.reason === 'string' && value.reason !== '' ? { reason: value.reason } : {},
      }
    }
    return { ok: false, message: '本机服务返回了异常的模型列表' }
  }
  const message = record.error?.message
  return { ok: false, message: typeof message === 'string' && message !== '' ? message : `获取模型列表失败（HTTP ${response.status}）` }
}

/** Load the official vision-provider directory for the add-provider flow. */
async function loadCatalog(): Promise<{ ok: true; catalog: VisionProviderCatalogEntry[] } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetch(CATALOG_ENDPOINT)
  } catch {
    return { ok: false, message: '网络错误：无法连接本机服务' }
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    return { ok: false, message: '本机服务返回了无法解析的响应' }
  }
  const record = envelope as { ok?: unknown; value?: { catalog?: unknown }; error?: { message?: unknown } } | null
  if (typeof record !== 'object' || record === null) return { ok: false, message: '本机服务响应异常' }
  if (record.ok === true && Array.isArray(record.value?.catalog)) {
    const catalog = record.value.catalog.filter((item): item is VisionProviderCatalogEntry => {
      if (typeof item !== 'object' || item === null) return false
      const e = item as Record<string, unknown>
      return typeof e.id === 'string' && typeof e.name === 'string' && typeof e.baseURL === 'string'
        && typeof e.defaultModel === 'string' && typeof e.apiKeyEnv === 'string'
    })
    return { ok: true, catalog }
  }
  const message = record.error?.message
  return { ok: false, message: typeof message === 'string' && message !== '' ? message : `获取提供方目录失败（HTTP ${response.status}）` }
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

  const providerOverrides = (p: ProviderCardState): Record<string, unknown> => ({
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
  // key, opens the editor, and the picker is already populated.
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
