/**
 * Bounded, TTL-expiring cache of successful vision answers. The cache key
 * includes every connection fact (provider, model, protocol, output cap) plus
 * the image bytes and prompt, so a configuration change can never hit an old
 * provider's answer.
 * @module dsh-plugin-image-mind/cache/vision-cache
 */

/** Default semantic-cache lifetime for a successful vision answer, in milliseconds. */
export const DEFAULT_CACHE_TTL_MS = 10_000
/** Default upper bound on cached vision answers. */
export const DEFAULT_CACHE_MAX_ENTRIES = 32

/** A bounded, TTL-expiring cache of successful vision answers. */
export interface VisionCache {
  get(key: string): string | undefined
  set(key: string, text: string): void
  readonly size: number
  clear(): void
}

/** Create a TTL-expiring, capacity-capped vision answer cache. */
export function createVisionCache(options?: { ttlMs?: number; maxEntries?: number }): VisionCache {
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS
  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES)
  const entries = new Map<string, { text: string; expiresAt: number }>()
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key)
        return undefined
      }
      return entry.text
    },
    set(key, text) {
      const now = Date.now()
      for (const [k, entry] of entries) if (entry.expiresAt <= now) entries.delete(k)
      entries.set(key, { text, expiresAt: now + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    get size() { return entries.size },
    clear() { entries.clear() },
  }
}
