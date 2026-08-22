/**
 * Credential-scoped wrapper around the OpenAI-compatible adapter.
 *
 * The underlying semantic cache key already isolates provider/model/endpoint,
 * image bytes and prompt. This wrapper adds the *resolved credential identity*
 * without ever storing the literal API key: a SHA-256 fingerprint is carried
 * in AsyncLocalStorage for the current call, then combined with the semantic
 * key and hashed again before the shared cache sees it.
 *
 * Async-local scoping keeps concurrent calls with different credentials from
 * racing through one mutable global "current key" slot.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { OpenAICompatibleVisionAdapter as BaseOpenAICompatibleVisionAdapter } from './adapter.ts'
import type { OpenAICompatibleAdapterOptions } from './adapter.ts'
import type { VisionCache } from '../../cache/vision-cache.ts'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Irreversible identity used only to namespace semantic-cache entries. */
export function credentialCacheFingerprint(apiKey: string): string {
  return sha256(`image-mind:credential:v1\0${apiKey}`)
}

function scopedCacheKey(credentialFingerprint: string | undefined, semanticKey: string): string {
  // A cache lookup should only happen after resolveApiKey has run. Fail closed
  // to an isolated sentinel namespace if a future call path violates that
  // ordering rather than falling back to an unscoped semantic key.
  const scope = credentialFingerprint ?? 'credential-scope-missing'
  return sha256(`image-mind:semantic-cache:v1\0${scope}\0${semanticKey}`)
}

function credentialScopedCache(cache: VisionCache, scope: AsyncLocalStorage<string>): VisionCache {
  return {
    get(key) {
      return cache.get(scopedCacheKey(scope.getStore(), key))
    },
    set(key, text) {
      cache.set(scopedCacheKey(scope.getStore(), key), text)
    },
    get size() {
      return cache.size
    },
    clear() {
      cache.clear()
    },
  }
}

/**
 * Public adapter class with credential-safe semantic caching.
 *
 * The base adapter remains responsible for protocol/retry/fallback semantics;
 * this thin layer only injects per-call cache namespace state.
 */
export class OpenAICompatibleVisionAdapter extends BaseOpenAICompatibleVisionAdapter {
  constructor(options: OpenAICompatibleAdapterOptions) {
    const credentialScope = new AsyncLocalStorage<string>()
    const cache = options.cache === undefined
      ? undefined
      : credentialScopedCache(options.cache, credentialScope)

    super({
      ...options,
      cache,
      resolveApiKey: async (connection) => {
        const apiKey = await options.resolveApiKey(connection)
        credentialScope.enterWith(credentialCacheFingerprint(apiKey))
        return apiKey
      },
    })
  }
}
