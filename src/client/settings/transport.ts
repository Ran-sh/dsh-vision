/**
 * Settings transport for the image-mind namespace. The official settings seam
 * serves third-party namespaces (verified against the installed rc.6 and the
 * harness master): `connection.api.settings.describe/mutate` read and write
 * any registered namespace, secrets are redacted on the wire, and
 * `connection.api.credentials.set` stores a typed key in the credential store
 * — never in `settings.yaml`. This transport prefers that seam and falls back
 * to the legacy `/image-mind/config` gateway only when the official wire is
 * unavailable (older shell).
 *
 * The snapshot mirrors the official `SettingsScopeSnapshot` contract: the
 * resolved `value`, the composition `base`, the raw `user` layer (whose key
 * presence marks a field overridden), and the revision fencing the next write.
 * @module dsh-plugin-image-mind/client/settings/transport
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-client-connection/client'

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

/** The wire view of one namespace. */
interface NamespaceViewLike {
  ns: string
  value: unknown
  base?: unknown
  user?: unknown
  revision: number
}

/** Whether the official settings wire is reachable through this connection. */
export function hasOfficialSettings(connection: ConnectionHandle | undefined): boolean {
  return connection !== undefined
    && typeof connection.api?.settings?.describe === 'function'
    && typeof connection.api?.settings?.mutate === 'function'
}

/** Build a snapshot from an official namespace view. */
function snapshotFromView(view: SettingsNamespaceView | undefined, writable: boolean, mode: 'host' | 'memory'): SettingsSnapshot {
  if (view === undefined) {
    return { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable, mode }
  }
  return {
    status: 'ready',
    value: (view.value ?? {}) as Record<string, unknown>,
    base: view.base,
    user: view.user,
    revision: view.revision,
    writable,
    mode,
  }
}

/** Read the image-mind namespace through the official wire. */
export async function readOfficial(connection: ConnectionHandle): Promise<SettingsSnapshot> {
  const response = await connection.api.settings.describe({})
  if (!response.result.ok) {
    throw new Error(response.result.error.message)
  }
  const { namespaces, writable } = response.result.value
  const view = namespaces.find(candidate => candidate.ns === VISION_NAMESPACE)
  return snapshotFromView(view, writable, connection.isLoopback ? 'host' : 'memory')
}

/** Apply path ops to the image-mind namespace through the official wire. */
export async function writeOfficial(
  connection: ConnectionHandle,
  ops: readonly SettingsOp[],
  expectedRevision?: number,
): Promise<SettingsSnapshot> {
  const response = await connection.api.settings.mutate({
    ns: VISION_NAMESPACE,
    ops: [...ops],
    ...expectedRevision === undefined ? {} : { expectedRevision },
  })
  if (!response.result.ok) {
    const error = response.result.error
    throw new Error(error.code === 'settings-conflict' ? '设置已被其他窗口修改，请刷新后重试' : error.message)
  }
  return snapshotFromView(response.result.value, response.result.value !== undefined ? true : false, 'host')
}

/** Store one credential value in the official credential store. */
export async function setCredentialOfficial(connection: ConnectionHandle, ref: string, value: string): Promise<void> {
  const response = await connection.api.credentials.set({ ref, value })
  if (!response.result.ok) {
    throw new Error(response.result.error.message)
  }
}

/** Describe one credential reference (configured state only, never the value). */
export async function describeCredentialOfficial(
  connection: ConnectionHandle,
  ref: string,
): Promise<{ configured: boolean; writable: boolean }> {
  const response = await connection.api.credentials.describe({ refs: [ref] })
  if (!response.result.ok) return { configured: false, writable: false }
  const view = response.result.value.credentials[ref]
  return { configured: view?.configured ?? false, writable: view?.writable ?? false }
}
