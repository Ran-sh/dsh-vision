/**
 * Cross-provider fallback policy for image-mind.
 *
 * Provider fallback is intentionally provider-plugin policy, not a
 * provider-neutral VisionRuntime concern. The runtime still resolves exactly
 * one provider route; image-mind may choose a configured backup only after
 * its selected endpoint has exhausted its own retry/model-recovery path.
 */

import type { VisionRequest } from '@ran-sh/dsh-vision'
import { isProviderComplete, type ResolvedConfig } from '../config.ts'

/** Hard ceiling: one primary plus at most two backup providers per call. */
export const MAX_AUTOMATIC_PROVIDER_FALLBACKS = 2

/**
 * Resolve ordered automatic backup providers for one selected route.
 *
 * Rules:
 * - explicit `request.provider` is user intent: never route elsewhere;
 * - explicit `request.model` is also sticky because that model id may not
 *   exist on another provider;
 * - only complete configured providers are candidates;
 * - preserve configuration insertion order and cap the fan-out.
 */
export function automaticProviderFallbacks(
  config: ResolvedConfig,
  primaryProvider: string,
  request: Pick<VisionRequest, 'provider' | 'model'>,
): string[] {
  if (request.provider !== undefined && request.provider.trim().length > 0) return []
  if (request.model !== undefined && request.model.trim().length > 0) return []

  const candidates: string[] = []
  for (const [id, spec] of Object.entries(config.providers)) {
    if (id === primaryProvider || !isProviderComplete(spec)) continue
    candidates.push(id)
    if (candidates.length >= MAX_AUTOMATIC_PROVIDER_FALLBACKS) break
  }
  return candidates
}
