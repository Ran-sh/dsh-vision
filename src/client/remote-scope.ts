/**
 * A CardForm-backed settings scope over the host config gateway. The registry
 * card form expects the SettingsScope surface (getSnapshot/subscribe/set/unset);
 * the official client settings scope cannot serve the third-party image-mind
 * namespace (hardcoded allowlist), so this adapter backs the same contract with
 * the plugin's own /image-mind/config route. Writes are per-field ops,
 * revision-fenced, and re-read from the host's accepted view.
 * @module dsh-plugin-image-mind/client/remote_scope
 */

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { loadConfig, saveConfig, subscribeConfig, type ConfigOp, type ConfigView } from './config-client.ts'

/** Compose the snapshot shape the form reads from a host config view. */
function snapshotOf(view: ConfigView): SettingsScopeSnapshot<Record<string, unknown>> {
  return {
    status: 'ready',
    value: view.value,
    base: view.base,
    user: view.user,
    revision: view.revision,
    writable: view.writable,
    mode: 'host',
  }
}

/**
 * Remote settings scope over the plugin config gateway. The current snapshot
 * starts 'loading' and settles 'ready' once the first host read lands; every
 * save refreshes it from the host's accepted view. External view changes
 * (the config gateway's own cache) notify the same listeners.
 */
export class RemoteConfigScope implements SettingsScope<Record<string, unknown>> {
  private view: SettingsScopeSnapshot<Record<string, unknown>> = {
    status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host',
  }

  constructor() {
    // Kick off the first host read; failures leave the loading state (the
    // card renders nothing until a view is available).
    const first = (): void => { void loadConfig().then(view => { this.view = snapshotOf(view); this.notify() }).catch(() => {}) }
    first()
    subscribeConfig(() => this.notify())
  }

  /** Read the current synchronous snapshot. */
  getSnapshot(): SettingsScopeSnapshot<Record<string, unknown>> {
    return this.view
  }

  /** Observe snapshot replacements. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Stage one field write through the host gateway. */
  async set(field: string, value: unknown): Promise<void> {
    const view = await saveConfig([{ op: 'set', path: [field], value }], this.view.revision)
    this.view = snapshotOf(view)
    this.notify()
  }

  /** Clear one field so it re-inherits the composition layer. */
  async unset(field: string): Promise<void> {
    const view = await saveConfig([{ op: 'unset', path: [field] }], this.view.revision)
    this.view = snapshotOf(view)
    this.notify()
  }

  /** Apply an ordered list of path ops, then refresh the snapshot. */
  async mutate(ops: readonly ConfigOp[]): Promise<ConfigView> {
    const view = await saveConfig(ops, this.view.revision)
    this.view = snapshotOf(view)
    this.notify()
    return view
  }

  private readonly listeners = new Set<() => void>()

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}