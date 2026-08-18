/**
 * Legacy inline API-key migration. Old settings documents may carry a
 * `providers.<id>.apiKey` value (written before the credential seam existed);
 * this module moves such a value into the DSH credential store under the
 * provider's `apiKeyEnv` reference (or a safely derived one), then clears the
 * inline field from the settings document so the secret lives in exactly one
 * place. The key never enters a log, never reaches the browser, and a failed
 * migration never silently drops the user's configuration.
 *
 * The migration is best-effort and idempotent: it runs at plugin apply for
 * the composition entry, and the settings card never creates inline keys, so
 * this path exists only for documents written before the seam was introduced.
 * @module dsh-plugin-image-mind/credentials/migrate
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { IMAGE_MIND_SETTINGS_NAMESPACE, type Provider } from '../config.ts'

/** Derive a safe credential reference from a provider id (e.g. `my-vision` → `MY_VISION_API_KEY`). */
import { deriveKeyRef } from '../client/settings/identity.ts'
export { deriveKeyRef }

/** One legacy inline key found in a stored section. */
export interface LegacyInlineKey {
  /** Provider id owning the inline key. */
  provider: string
  /** The reference the key should live under after migration. */
  ref: string
  /** The secret value (host-process only; never logged or serialized). */
  value: string
}

/**
 * Collect every legacy inline key in a raw config: providers that carry an
 * `apiKey` field. The target reference is the provider's `apiKeyEnv` when it
 * names one, else a safe derivation from the provider id.
 * @param providers - raw provider entries from the settings document.
 * @returns the legacy keys, or an empty array when none exist.
 */
export function collectLegacyInlineKeys(providers: Record<string, Provider> | undefined): LegacyInlineKey[] {
  if (providers === undefined) return []
  const found: LegacyInlineKey[] = []
  for (const [provider, entry] of Object.entries(providers)) {
    const raw = entry?.apiKey
    if (typeof raw !== 'string' || raw.length === 0) continue
    const ref = (entry?.apiKeyEnv !== undefined && entry.apiKeyEnv.trim().length > 0)
      ? entry.apiKeyEnv.trim()
      : deriveKeyRef(provider)
    found.push({ provider, ref, value: raw })
  }
  return found
}

/**
 * Migrate every legacy inline key in the settings document into the
 * credential store, then clear the inline fields. Runs once per apply against
 * the stored user section; a failed store write keeps the inline field so the
 * user's configuration is not lost, and logs the failure without the value.
 * @param ctx - registrant context (optional credential + settings seams).
 * @param providers - the raw provider entries as stored.
 * @returns the number of keys migrated.
 */
export async function migrateLegacyInlineKeys(
  ctx: Context,
  providers: Record<string, Provider> | undefined,
): Promise<number> {
  const legacy = collectLegacyInlineKeys(providers)
  if (legacy.length === 0) return 0
  const credentials = ctx.get('credentials')
  const settings = ctx.get('settings')
  if (credentials === undefined || settings === undefined) {
    // No writable seam: keep the inline keys (host-only fallback still
    // resolves them), never drop the user's configuration.
    ctx.logger.warn('image-mind: found legacy inline apiKey fields but no credential seam; keeping them (host-only)')
    return 0
  }
  const ops: Array<{ op: 'unset'; path: readonly string[] }> = []
  let migrated = 0
  for (const key of legacy) {
    try {
      // Store under the target reference; a read-only shadowing layer rejects.
      await credentials.set(credentialRef(key.ref), key.value)
      ops.push({ op: 'unset', path: ['providers', key.provider, 'apiKey'] })
      migrated += 1
    } catch (error) {
      // Never lose the configuration: keep the inline field and say why
      // (without the value).
      ctx.logger.error(`image-mind: failed to migrate inline apiKey for provider "${key.provider}" into ${key.ref}; keeping it (host-only)`)
      ctx.logger.error(error)
    }
  }
  if (ops.length > 0) {
    try {
      const settingsAny = settings as unknown as { mutate(ns: unknown, ops: readonly { op: 'unset'; path: readonly string[] }[], revision?: number): Promise<void> }
      await settingsAny.mutate(IMAGE_MIND_SETTINGS_NAMESPACE, ops)
    } catch (error) {
      ctx.logger.error('image-mind: inline keys stored but the settings document could not be cleared; they remain host-only fallbacks')
      ctx.logger.error(error)
    }
  }
  return migrated
}
