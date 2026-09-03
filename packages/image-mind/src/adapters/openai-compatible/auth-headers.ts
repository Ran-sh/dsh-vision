/**
 * Authorization-header construction shared by the wire call and model
 * discovery. An empty bearer (a keyless localhost endpoint) must not be sent
 * as an `Authorization: Bearer ` header: some strict OpenAI-compatible
 * servers reject an empty bearer while accepting no header at all.
 * @module dsh-plugin-image-mind/adapters/openai-compatible/auth-headers
 */

/** Headers for one request: no authorization header when no key is present. */
export function authHeaders(apiKey: string): Record<string, string> {
  return apiKey === ''
    ? {}
    : { authorization: `Bearer ${apiKey}` }
}
