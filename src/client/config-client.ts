/**
 * Browser accessor for the image-mind settings section, served by the host
 * `/image-mind/config` route. The official settings wire refuses third-party
 * namespaces (its allowlist is hardcoded), so the card reads and writes the
 * section through this plugin-owned gateway instead; secrets never leave the
 * host — the view replaces `apiKey` with an `apiKeyConfigured` flag.
 *
 * A short-lived module cache backs the conversation preview toggle; every
 * save refreshes it and notifies listeners.
 * @module dsh-plugin-image-mind/client/config_client
 */

/** One field-indexed write the host applies to the section. */
export type ConfigOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** One provider as the browser sees it: secret replaced by flags, never a value. */
export interface ProviderView {
  baseURL?: string
  model?: string
  apiKeyEnv?: string
  apiStyle?: string
  maxOutputTokens?: number
  /** Whether the provider has an inline `apiKey` set in the stored document. */
  apiKeyConfigured: boolean
  /** `*` repeated for the resolved key's length; empty when no key resolves. */
  apiKeyMask: string
}

/** Section as the browser sees it: redacted on the host. */
export interface ConfigView {
  /** Monotonic revision fencing the next write. */
  revision: number
  /** Redacted resolved section, with `providers` enriched as ProviderView. */
  value: Record<string, unknown> & {
    providers?: Record<string, ProviderView>
    active?: string
    defaultPrompt?: string
    maxBytes?: number
    timeoutMs?: number
    renderImagePreview?: boolean
  }
  /** Composition base layer (redacted), when a mount declared one. */
  base?: unknown
  /** Raw user section (redacted), when one stands. */
  user?: unknown
  /** Whether the host accepts writes. */
  writable: boolean
}

/** Structured rejection from the host gateway. */
interface ConfigRejection {
  code: string
  message: string
}

/** The config endpoint, same-origin with the web shell. */
const CONFIG_ENDPOINT = '/image-mind/config'

/** The connection-test endpoint, same-origin with the web shell. */
const TEST_ENDPOINT = '/image-mind/test'

/** The model-listing endpoint, same-origin with the web shell. */
const MODELS_ENDPOINT = '/image-mind/models'

/** The official-provider directory endpoint, same-origin with the web shell. */
const CATALOG_ENDPOINT = '/image-mind/catalog'

/** One official vision provider the "添加提供方" flow offers. */
export interface VisionProviderCatalogEntry {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  apiKeyEnv: string
}

/** Outcome of a catalog fetch. */
export type CatalogOutcome = { ok: true; catalog: VisionProviderCatalogEntry[] } | { ok: false; message: string }

/** Load the official vision-provider directory for the add-provider flow. */
export async function loadCatalog(): Promise<CatalogOutcome> {
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

/** Draft field values the card may layer over the saved section for one test. */
export interface TestOverrides {
  baseURL?: string
  model?: string
  apiKey?: string
  apiKeyEnv?: string
  apiStyle?: string
  maxOutputTokens?: number
  timeoutMs?: number
}

/** Outcome of one connection test, as reported by the host probe. */
export type TestOutcome =
  | { ok: true; text: string }
  | { ok: false; message: string }

/**
 * Ask the host to run one real vision call with the given draft overrides and
 * tell us whether the deployment connects. The request goes out from the host
 * process, so the key never crosses to the browser.
 * @param overrides - draft field values (partial; the host layers over saved).
 * @returns the model reply on success, or a readable failure reason.
 */
export async function testConnection(overrides: TestOverrides): Promise<TestOutcome> {
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

/** Outcome of one model-list request against the host gateway. */
export type ModelsOutcome =
  | { ok: true; models: string[]; source: 'endpoint' | 'fallback'; reason?: string }
  | { ok: false; message: string }

/**
 * Ask the host to list model ids for the current endpoint (draft values may
 * override the saved section). Falls back to a built-in vision-model list when
 * the endpoint cannot answer, so the picker always has candidates.
 * @param overrides - draft field values (partial; the host layers over saved).
 * @returns the candidate model ids and their source.
 */
export async function listModels(overrides: TestOverrides): Promise<ModelsOutcome> {
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

/** Module-level cache; undefined until the first load. */
let cached: ConfigView | undefined
/** Listeners notified whenever the view changes. */
const listeners = new Set<() => void>()

/** Notify every listener after a view change. */
function notify(): void {
  for (const listener of listeners) listener()
}

/** The current cached view, without forcing a load. */
export function peekConfig(): ConfigView | undefined {
  return cached
}

/** Subscribe to view changes; returns the disposer. */
export function subscribeConfig(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Load the section through the host gateway and cache it. */
export async function loadConfig(): Promise<ConfigView> {
  const response = await fetch(CONFIG_ENDPOINT)
  const envelope = await response.json() as { ok: unknown; value?: ConfigView; error?: ConfigRejection }
  if (response.ok && envelope.ok === true && envelope.value !== undefined) {
    cached = envelope.value
    notify()
    return envelope.value
  }
  throw new Error(envelope.error?.message ?? `config read failed (HTTP ${response.status})`)
}

/**
 * Apply staged writes and refresh the cache from the host's accepted view.
 * @param ops - field-indexed writes.
 * @param expectedRevision - the revision the caller read.
 * @returns the accepted view.
 */
export async function saveConfig(ops: readonly ConfigOp[], expectedRevision?: number): Promise<ConfigView> {
  const response = await fetch(CONFIG_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops, ...expectedRevision === undefined ? {} : { expectedRevision } }),
  })
  const envelope = await response.json() as { ok: unknown; value?: ConfigView; error?: ConfigRejection }
  if (response.ok && envelope.ok === true && envelope.value !== undefined) {
    cached = envelope.value
    notify()
    return envelope.value
  }
  throw new Error(envelope.error?.message ?? `config write failed (HTTP ${response.status})`)
}
