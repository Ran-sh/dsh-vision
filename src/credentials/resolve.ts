/**
 * Credential resolution for one vision connection. Mirrors the official
 * `assertUsableApiKey` contract: a stored key arrives from the credentials
 * seam or the launch environment, both of which pick up surrounding
 * whitespace, so trimming is silent. Resolution order: credential seam →
 * launch environment → missing-credential error. The key never enters a
 * message: the reference names where to fix it.
 * @module dsh-plugin-image-mind/credentials/resolve
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { VisionError } from '../runtime/errors.ts'
import type { VisionConnection } from '../runtime/types.ts'
import { isKeylessEndpoint } from '../config.ts'

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
    throw new VisionError(
      `image-mind: the credential resolved through ${ref} is not usable (empty or contains control characters)`,
      'INVALID_CREDENTIAL',
    )
  }
  return trimmed
}

/**
 * Resolve the bearer token for one connection snapshot. The endpoint and the
 * secret sent to it come from the same resolution: the snapshot is passed in,
 * never re-read. Localhost endpoints (Ollama / LM Studio / vLLM) are keyless
 * and resolve to an empty bearer.
 * @param ctx - registrant context carrying the optional credential seam.
 * @param connection - immutable connection facts for this one call.
 * @returns the resolved bearer token.
 */
export async function resolveApiKey(ctx: Context, connection: VisionConnection): Promise<string> {
  const ref = connection.apiKeyEnv
  if (ref !== undefined) {
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(credentialRef(ref)))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, ref)
  }
  if (isKeylessEndpoint(connection.baseURL)) return ''
  throw new VisionError(
    `image-mind: no API key for provider "${connection.provider}"; store ${ref ?? 'a credential reference'} through`
    + ' the credentials service (the web settings card writes it), or export it in the launching environment',
    'MISSING_CREDENTIAL',
  )
}

export type { CredentialRef }
