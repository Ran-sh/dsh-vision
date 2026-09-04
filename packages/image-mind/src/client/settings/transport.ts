/**
 * Settings transport for the image-mind namespace on the alpha Harness line.
 *
 * The browser no longer talks to `connection.api.settings/describe-mutate`
 * directly. It consumes the split alpha client services:
 * `ctx.settingsScope.bind({ namespace: 'image-mind' })` for the settings
 * snapshot + writes, and `ctx.remote.credentials` for typed-key storage.
 * The snapshot mirrors the `SettingsScopeSnapshot` contract: the resolved
 * `value`, the composition `base`, the raw `user` layer (whose key presence
 * marks a field overridden), and the revision fencing the next write.
 * @module dsh-plugin-image-mind/client/settings/transport
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The image-mind settings namespace. */
export const VISION_NAMESPACE = 'image-mind'

/** One path-addressed write (official wire shape). */
export type SettingsOp = SettingsPathOpView

/** The snapshot the settings card renders from. */
export interface SettingsSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory' | 'legacy'
}

/** Minimal structural view of the rc.1 `remote.credentials` face. */
export interface RemoteCredentials {
  set(ref: string, value: string): Promise<{ ok: boolean; error?: { message?: string } }>
  describe(refs: string[]): Promise<{
    ok: boolean
    value?: Record<string, { configured?: boolean; writable?: boolean }>
    error?: { message?: string }
  }>
}

/** Minimal structural view of the alpha `remote` face the card consumes. */
export interface RemoteFace {
  credentials?: RemoteCredentials
}

/** Minimal structural view of the client context the card consumes. */
export interface ImageMindClientContext {
  settingsScope?: { bind<T>(spec: { namespace: string }): SettingsScope<T> }
  remote?: RemoteFace
  get?(service: string): unknown
}

/** Resolve the bound settings scope for the image-mind namespace. */
export function resolveScope(ctx: ImageMindClientContext): SettingsScope<Record<string, unknown>> | undefined {
  try {
    const viaGet = (ctx.get?.('settingsScope') as { bind<T>(spec: { namespace: string }): SettingsScope<T> } | undefined)
      ?.bind<Record<string, unknown>>({ namespace: VISION_NAMESPACE })
    if (viaGet !== undefined) return viaGet
    return ctx.settingsScope?.bind<Record<string, unknown>>({ namespace: VISION_NAMESPACE })
  } catch {
    return undefined
  }
}

/** Resolve the rc.1 remote credentials face. The cordis `remote` service is an
 * injected getter: touching `ctx.remote` without the injection throws instead
 * of returning undefined, so every access must be guarded — the card must
 * degrade to "credentials unavailable" (settings stay editable, keys just
 * cannot be stored) rather than crash a save. */
export function resolveCredentials(ctx: ImageMindClientContext): RemoteCredentials | undefined {
  try {
    // The `get` path is a plain lookup and never throws; prefer it.
    const viaGet = (ctx.get?.('remote') as RemoteFace | undefined)?.credentials
    if (viaGet !== undefined) return viaGet
    const direct = ctx.remote?.credentials
    return direct
  } catch {
    return undefined
  }
}

/** Whether the alpha settings scope is live for this context. */
export function hasOfficialSettings(ctx: ImageMindClientContext | undefined): boolean {
  return ctx !== undefined && resolveScope(ctx) !== undefined
}

/** Build a card snapshot from a scope snapshot. */
export function snapshotFromScope(
  snapshot: SettingsScopeSnapshot<Record<string, unknown>>,
  mode: 'host' | 'memory',
): SettingsSnapshot {
  if (snapshot.status !== 'ready') {
    return {
      status: snapshot.status === 'loading' ? 'loading' : 'unavailable',
      value: undefined,
      base: snapshot.base,
      user: snapshot.user,
      revision: snapshot.revision,
      writable: false,
      mode,
    }
  }
  return {
    status: 'ready',
    value: (snapshot.value ?? {}) as Record<string, unknown>,
    base: snapshot.base,
    user: snapshot.user,
    revision: snapshot.revision,
    writable: snapshot.writable,
    mode,
  }
}

/** Read the image-mind namespace through a bound scope (mirror snapshot). */
export function snapshotFromBoundScope(scope: SettingsScope<Record<string, unknown>>): SettingsSnapshot {
  return snapshotFromScope(scope.getSnapshot(), 'host')
}

/** Apply path ops through a bound scope; the scope mirror is the source of truth. */
export async function writeThroughScope(
  scope: SettingsScope<Record<string, unknown>>,
  ops: readonly SettingsOp[],
  expectedRevision?: number,
): Promise<SettingsSnapshot> {
  try {
    await scope.mutate(ops, expectedRevision)
  } catch (error) {
    const message = (error as Error).message
    throw new Error(/conflict/i.test(message) ? '设置已被其他窗口修改，请刷新后重试' : message)
  }
  return snapshotFromScope(scope.getSnapshot(), 'host')
}

/** Read the image-mind namespace through the bound scope. */
export async function readOfficial(ctx: ImageMindClientContext): Promise<SettingsSnapshot> {
  const scope = resolveScope(ctx)
  if (scope === undefined) {
    return { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'legacy' }
  }
  return snapshotFromScope(scope.getSnapshot(), 'host')
}

/** Apply path ops to the image-mind namespace through the bound scope. */
export async function writeOfficial(
  ctx: ImageMindClientContext,
  ops: readonly SettingsOp[],
  expectedRevision?: number,
): Promise<SettingsSnapshot> {
  const scope = resolveScope(ctx)
  if (scope === undefined) throw new Error('image-mind settings scope is not available')
  try {
    await scope.mutate(ops, expectedRevision)
  } catch (error) {
    const message = (error as Error).message
    throw new Error(/conflict/i.test(message) ? '设置已被其他窗口修改，请刷新后重试' : message)
  }
  return snapshotFromScope(scope.getSnapshot(), 'host')
}

/** Store one credential value in the official credential store. */
export async function setCredentialOfficial(ctx: ImageMindClientContext, ref: string, value: string): Promise<void> {
  const credentials = resolveCredentials(ctx)
  if (credentials === undefined) throw new Error('image-mind credential store is not available')
  const response = await credentials.set(ref, value)
  if (!response.ok) {
    throw new Error(response.error?.message ?? 'credential store rejected the write')
  }
}

/** Describe one credential reference (configured state only, never the value). */
export async function describeCredentialOfficial(
  ctx: ImageMindClientContext,
  ref: string,
): Promise<{ configured: boolean; writable: boolean }> {
  const credentials = resolveCredentials(ctx)
  if (credentials === undefined) return { configured: false, writable: false }
  const response = await credentials.describe([ref])
  if (!response.ok) return { configured: false, writable: false }
  const view = response.value?.[ref]
  return { configured: view?.configured ?? false, writable: view?.writable ?? false }
}
