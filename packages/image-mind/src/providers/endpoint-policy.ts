/**
 * Endpoint policy for vision providers: a credential must never be sent to a
 * non-loopback http:// endpoint, embedded credentials or query/hash on a
 * provider URL are refused, and only http(s) is a valid vision transport.
 * Every consumer (config resolution, connection test, model discovery, and
 * the runtime adapter) validates through the same rule.
 * @module dsh-plugin-image-mind/providers/endpoint-policy
 */

/** Loopback hostnames that are allowed to use plain http with a key. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Whether a hostname is a loopback-style local endpoint. */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

export interface EndpointPolicyError extends Error {
  readonly code: 'UNSUPPORTED_PROTOCOL' | 'EMBEDDED_CREDENTIALS' | 'URL_QUERY_OR_HASH' | 'INSECURE_HTTP'
}

function policyError(code: EndpointPolicyError['code'], message: string): EndpointPolicyError {
  const error = new Error(message) as EndpointPolicyError
  error.name = 'EndpointPolicyError'
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

/**
 * Validate one provider endpoint root. Returns the parsed URL when it may be
 * used; otherwise throws with a stable `code`.
 * @param baseURL - the provider endpoint root.
 * @param credentialRequired - whether a secret will be attached to requests to
 * this endpoint (remote http + credential is refused).
 * @returns the validated URL.
 */
export function validateProviderEndpoint(baseURL: string, credentialRequired: boolean): URL {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    throw policyError('UNSUPPORTED_PROTOCOL', `image-mind: provider baseURL ${JSON.stringify(baseURL)} is not a valid http(s) URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw policyError('UNSUPPORTED_PROTOCOL', `image-mind: provider baseURL must use http or https, got ${JSON.stringify(url.protocol)}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw policyError('EMBEDDED_CREDENTIALS', 'image-mind: provider baseURL must not embed a username or password; use the apiKeyEnv credential seam')
  }
  if (url.search !== '' || url.hash !== '') {
    throw policyError('URL_QUERY_OR_HASH', 'image-mind: provider baseURL must not carry a query string or hash fragment')
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname) && credentialRequired) {
    throw policyError('INSECURE_HTTP', 'image-mind: remote vision endpoints must use HTTPS; HTTP is allowed only for loopback endpoints (localhost / 127.0.0.1)')
  }
  return url
}
