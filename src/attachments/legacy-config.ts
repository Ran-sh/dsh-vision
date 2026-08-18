/**
 * Legacy settings gateway for the image-mind namespace. The official settings
 * seam now serves third-party namespaces through `ctx.settingsScope` /
 * `settings.mutate` (verified against the installed rc.6 and the harness
 * master), so the card reads and writes through that seam and this gateway is
 * a compatibility transport only — kept so older clients keep working, and
 * deletable once no consumer needs it. Secrets never leave the host: the view
 * replaces `apiKey` with a `configured` flag and a mask, never a value.
 * @module dsh-plugin-image-mind/attachments/legacy-config
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { IMAGE_MIND_SETTINGS_NAMESPACE, isKeylessEndpoint } from '../config.ts'

/** Mask source constant for a configured API key; the mask width mirrors the key length. */
const API_KEY_MASK_CHAR = '*'

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Redacted view of the image-mind settings section, safe for the browser. */
export interface ConfigView {
  /** Monotonic revision fencing the next write. */
  revision: number
  /** Resolved section with every secret stripped; per-provider `apiKeyConfigured`/`apiKeyMask`. */
  value: Record<string, unknown>
  /** Composition `base` layer (redacted), if the mount declared one. */
  base?: unknown
  /** Raw user section from the stored document (redacted), when one exists. */
  user?: unknown
  /** Whether the settings provider accepts writes. */
  writable: boolean
}

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
  /**
   * Whether the provider can actually authenticate today: endpoint+model are
   * named and a key resolves (inline or through the env seam). This is the
   * row's status lamp truth — a provider without a usable key is never
   * "connected".
   */
  keyReady: boolean
  /** Whether endpoint and model are both filled (regardless of key). */
  complete: boolean
}

/** The image-mind section as the browser edits it. */
export interface ConfigSection {
  /** Monotonic revision the caller read; refuses stale writes. */
  expectedRevision?: number
  /** Path-addressed writes; set stores, unset clears to re-inherit. */
  ops: Array<{ op: 'set'; path: readonly string[]; value: unknown } | { op: 'unset'; path: readonly string[] }>
}

/**
 * Whether the deployment currently has a usable vision key, and its mask.
 * The mask is `*` repeated for the key's length; only the length leaves the
 * host, never the key.
 * @param ctx - registrant context.
 * @param envName - credential-reference name for the API key.
 * @param inlineKeyLength - non-empty inline key length, or undefined when absent.
 * @returns the mask for a usable key, or an empty string when no key resolves.
 */
async function resolveKeyMask(ctx: Context, envName: string | undefined, inlineKeyLength: number | undefined): Promise<string> {
  if (inlineKeyLength !== undefined && inlineKeyLength > 0) return API_KEY_MASK_CHAR.repeat(inlineKeyLength)
  if (typeof envName !== 'string' || envName.length === 0) return ''
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(credentialRef(envName))
      return hit !== undefined ? API_KEY_MASK_CHAR.repeat(hit.value.length) : ''
    } catch {
      return ''
    }
  }
  const ambient = launchEnvironmentOf(ctx).get(envName)
  return ambient !== undefined && ambient.value.length > 0 ? API_KEY_MASK_CHAR.repeat(ambient.value.length) : ''
}

/** A description descriptor as the config view reads it. */
interface ConfigDescriptor {
  ns: string
  revision?: number
  value?: unknown
  base?: unknown
  user?: unknown
  /** Secret positions enumerated under redaction; `set` says the field held a value. */
  secrets?: Array<{ path: string[]; set: boolean }>
}

/** Build the redacted config view from the registered section descriptor. */
async function configView(ctx: Context, settings: {
  describe(options: { redactSecrets: true }): ConfigDescriptor[]
  get(ns: string): unknown
}, writable: boolean): Promise<ConfigView | undefined> {
  const desc = settings.describe({ redactSecrets: true }).find(d => d.ns === IMAGE_MIND_SETTINGS_NAMESPACE)
  if (desc === undefined) return undefined
  const value = (desc.value ?? {}) as Record<string, unknown>
  const raw = (settings.get(IMAGE_MIND_SETTINGS_NAMESPACE) ?? {}) as Record<string, unknown>
  const rawProviders = asRecord(raw['providers'])
  const providerRecords = asRecord(value['providers'])
  const providers: Record<string, ProviderView> = {}
  if (providerRecords !== undefined) {
    for (const [id, pv] of Object.entries(providerRecords)) {
      const p = asRecord(pv) ?? {}
      const inlineSet = desc.secrets?.some(secret =>
        secret.path.length === 3 && secret.path[0] === 'providers' && secret.path[1] === id && secret.path[2] === 'apiKey' && secret.set) ?? false
      let inlineKeyLength: number | undefined
      if (inlineSet) {
        const rp = asRecord(rawProviders?.[id])
        if (typeof rp?.['apiKey'] === 'string') inlineKeyLength = rp['apiKey'].length
      }
      const apiKeyEnv = typeof p['apiKeyEnv'] === 'string' ? p['apiKeyEnv'] : undefined
      const mask = await resolveKeyMask(ctx, apiKeyEnv, inlineKeyLength)
      const baseURL = typeof p['baseURL'] === 'string' ? p['baseURL'] : ''
      const model = typeof p['model'] === 'string' ? p['model'] : ''
      const complete = baseURL.trim().length > 0 && model.trim().length > 0
      // A localhost endpoint is keyless, so it counts as key-ready when complete.
      const keyReady = mask.length > 0 || (complete && isKeylessEndpoint(baseURL))
      providers[id] = {
        ...p,
        apiKeyConfigured: inlineSet,
        apiKeyMask: mask,
        keyReady,
        complete,
      }
    }
  }
  const nextValue: Record<string, unknown> = { ...value, providers }
  return {
    revision: desc.revision ?? 0,
    value: nextValue,
    ...desc.base === undefined ? {} : { base: desc.base },
    ...desc.user === undefined ? {} : { user: desc.user },
    writable,
  }
}

/** Read the image-mind settings section for the browser card (legacy gateway). */
export async function readConfigView(ctx: Context): Promise<ConfigView | undefined> {
  const settings = ctx.get('settings')
  if (settings === undefined) return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return configView(ctx, settings as any, (settings as any).writable ?? false)
}

/**
 * Apply the browser card's field writes to the image-mind section through the
 * host settings provider (`mutate`: path-addressed, redacted-view safe).
 * @param ctx - registrant context.
 * @param body - the parsed request body.
 * @returns the new redacted view, or a structured rejection.
 */
export async function writeConfigView(ctx: Context, body: unknown): Promise<{ ok: true; value: ConfigView } | { ok: false; error: { code: string; message: string } }> {
  const settings = ctx.get('settings')
  if (settings === undefined) {
    return { ok: false, error: { code: 'internal', message: 'the settings service is not mounted; cannot persist image-mind config' } }
  }
  const record = body as ConfigSection | undefined
  if (typeof record !== 'object' || record === null || !Array.isArray(record.ops)) {
    return { ok: false, error: { code: 'rejected', message: 'request body must be a JSON object with an ops array' } }
  }
  for (const op of record.ops) {
    if (op.op !== 'set' && op.op !== 'unset') {
      return { ok: false, error: { code: 'rejected', message: 'each op must be a set or unset write' } }
    }
    const path = op.path
    const valid = Array.isArray(path) && path.length >= 1 && path.length <= 3
      && path.every(seg => typeof seg === 'string' && seg.length > 0)
      && (path.length === 1 || (path[0] === 'providers' && path.length === 3))
    if (!valid) {
      return { ok: false, error: { code: 'rejected', message: 'each op must carry a valid path (a top-level field, or providers.<id>.<field>)' } }
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (settings as any).mutate(IMAGE_MIND_SETTINGS_NAMESPACE, record.ops, record.expectedRevision)
  } catch (error) {
    return { ok: false, error: { code: 'rejected', message: (error as Error).message ?? String(error) } }
  }
  const view = await configView(ctx, settings as never, (settings as { writable?: boolean }).writable ?? false)
  if (view === undefined) {
    return { ok: false, error: { code: 'internal', message: 'image-mind section vanished after write' } }
  }
  return { ok: true, value: view }
}
