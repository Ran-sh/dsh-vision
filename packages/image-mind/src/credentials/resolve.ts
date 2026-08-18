/**
 * Credential resolution for one vision endpoint snapshot. Mirrors the official
 * llm-deepseek precedence: when the credentials seam is mounted it owns the
 * whole credential plane (a miss there is a miss — the launch environment is
 * not consulted); only a deployment without the seam falls back to the
 * launch environment. A probe/draft snapshot may carry a one-shot
 * `inlineApiKey`, which wins over the seam for that call alone. The key never
 * enters a message: the reference names where to fix it.
 * @module dsh-plugin-image-mind/credentials/resolve
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { isKeylessEndpoint } from '../config.ts'
import type { OpenAICompatibleVisionOptions } from '../adapters/openai-compatible/types.ts'
import { ImageMindVisionError } from '../adapters/openai-compatible/adapter.ts'

/**
 * Accept one supplied credential, or refuse it as unusable. A stored key may
 * carry surrounding whitespace; anything else fails here rather than inside
 * `fetch`, and the key never enters the message.
 * @param raw - the credential exactly as supplied.
 * @param ref - the credential reference the value resolved through.
 * @returns the trimmed, usable key.
 */
export function assertUsableApiKey(raw: string, ref: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ImageMindVisionError(
      `image-mind: the credential resolved through ${ref} is not usable (empty or contains control characters)`,
      'INVALID_CREDENTIAL',
    )
  }
  return trimmed
}

/**
 * Resolve the bearer token for one endpoint snapshot. The endpoint and the
 * secret sent to it come from the same resolution: the snapshot is passed in,
 * never re-read. Localhost endpoints (Ollama / LM Studio / vLLM) are keyless
 * and resolve to an empty bearer.
 * @param ctx - registrant context carrying the optional credential seam.
 * @param options - immutable endpoint facts for this one call.
 * @returns the resolved bearer token.
 */
export async function resolveApiKey(ctx: Context, options: OpenAICompatibleVisionOptions): Promise<string> {
  // A one-shot draft/probe key wins for this call alone; it lives only in the
  // in-memory snapshot and is never persisted or sent to the browser.
  if (options.inlineApiKey !== undefined) {
    return assertUsableApiKey(options.inlineApiKey, options.provider)
  }
  const ref = options.apiKeyEnv
  if (ref !== undefined) {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      // The managed credential plane owns resolution when mounted: a miss
      // here is authoritative, and the launch environment is not consulted.
      const hit = await credentials.resolve(credentialRef(ref))
      if (hit !== undefined && hit.value.length > 0) return assertUsableApiKey(hit.value, ref)
    } else {
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, ref)
    }
  }
  if (isKeylessEndpoint(options.baseURL)) return ''
  throw new ImageMindVisionError(
    `image-mind: no API key for provider "${options.provider}"; store ${ref ?? 'a credential reference'} through`
    + ' the credentials service (the web settings card writes it), or export it in the launching environment',
    'MISSING_CREDENTIAL',
  )
}

export type { CredentialRef }
