/**
 * Credential-scoped wrapper around the OpenAI-compatible adapter.
 *
 * The underlying semantic cache key already isolates provider/model/endpoint,
 * image bytes and prompt. This wrapper adds the *resolved credential identity*
 * without ever storing the literal API key.
 *
 * Each public call gets a fresh base-adapter delegate plus a tiny local
 * credential slot. That slot is updated immediately after the delegate
 * resolves a credential and is read only by that delegate's cache wrapper.
 * Concurrent calls therefore never share mutable credential state.
 */

import { createHash } from 'node:crypto'
import { VisionAdapter } from '@ran-sh/dsh-vision'
import type { VisionModel, VisionModelDiscoveryRequest, VisionRequest, VisionResult } from '@ran-sh/dsh-vision'
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
  // Base adapter cache access happens after credential resolution. Fail closed
  // to an isolated sentinel namespace if a future path violates that ordering.
  const scope = credentialFingerprint ?? 'credential-scope-missing'
  return sha256(`image-mind:semantic-cache:v1\0${scope}\0${semanticKey}`)
}

function credentialScopedCache(cache: VisionCache, currentFingerprint: () => string | undefined): VisionCache {
  return {
    get(key) {
      return cache.get(scopedCacheKey(currentFingerprint(), key))
    },
    set(key, text) {
      cache.set(scopedCacheKey(currentFingerprint(), key), text)
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
 * A fresh base delegate is created per public operation. The base adapter still
 * owns protocol, retry, split, model fallback and provider fallback semantics;
 * this layer only gives that one operation an isolated cache namespace slot.
 */
export class OpenAICompatibleVisionAdapter extends VisionAdapter {
  constructor(private readonly options: OpenAICompatibleAdapterOptions) {
    super()
  }

  private delegate(): BaseOpenAICompatibleVisionAdapter {
    let credentialFingerprint: string | undefined
    const cache = this.options.cache === undefined
      ? undefined
      : credentialScopedCache(this.options.cache, () => credentialFingerprint)

    return new BaseOpenAICompatibleVisionAdapter({
      ...this.options,
      cache,
      resolveApiKey: async (connection) => {
        const apiKey = await this.options.resolveApiKey(connection)
        credentialFingerprint = credentialCacheFingerprint(apiKey)
        return apiKey
      },
    })
  }

  override async call(provider: string, request: VisionRequest): Promise<VisionResult> {
    return this.delegate().call(provider, request)
  }

  override async discoverModels(provider: string, request?: VisionModelDiscoveryRequest): Promise<readonly VisionModel[]> {
    return this.delegate().discoverModels(provider, request)
  }
}
