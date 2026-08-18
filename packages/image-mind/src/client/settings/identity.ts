/**
 * Pure provider-identity helpers shared by the browser store and host-side
 * logic: route-id validation, keyless-endpoint facts, the connection
 * fingerprint that ties a test/discovery result to one configuration, and
 * the conventional credential reference derivation. No client-runtime and no
 * server-only import — host and tests can use these without a browser, and
 * bundling this module into the client never drags a server package in.
 * @module dsh-plugin-image-mind/client/settings/identity
 */

/** A stable route id: lowercase letter start, then a-z 0-9 . _ -; must not
 * end with a separator (a trailing '-' or '.' is an easy-to-confuse id). */
export const PROVIDER_ID_RE = /^[a-z](?:[a-z0-9._-]*[a-z0-9])?$/

/** Whether an id satisfies the provider route rules (never derived from display name). */
export function isValidProviderId(id: string): boolean {
  return PROVIDER_ID_RE.test(id)
}

/** Local-endpoint roots that need no credential. */
const KEYLESS_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Whether a baseURL root is a known keyless local endpoint. */
export function isKeylessBaseURL(baseURL: string): boolean {
  try {
    return KEYLESS_HOSTS.has(new URL(baseURL).hostname)
  } catch {
    return false
  }
}

/** The key-input state that participates in a connection fingerprint. */
export type KeyState = 'none' | 'masked' | 'typed'

/** Classify a key input: a mask is identity; a typed value is a new connection. */
export function keyStateOf(apiKeyText: string): KeyState {
  if (apiKeyText.length === 0) return 'none'
  return /^\*+$/.test(apiKeyText) ? 'masked' : 'typed'
}

/**
 * The immutable connection fingerprint one test/discovery result belongs to:
 * every provider field that changes the wire request. A config edit past a
 * successful test invalidates the stored result.
 */
export function connectionFingerprint(p: {
  baseURL: string
  model: string
  apiStyle: string
  maxOutputTokens: string
  apiKeyEnv: string
  apiKeyConfigured: boolean
  keyless: boolean
  apiKeyText: string
}): string {
  return JSON.stringify([
    p.baseURL.trim(), p.model.trim(), p.apiStyle.trim(), p.maxOutputTokens.trim(),
    p.apiKeyEnv.trim(), p.apiKeyConfigured, p.keyless, keyStateOf(p.apiKeyText),
  ])
}

/** Derive the conventional credential reference for a provider route. */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}
