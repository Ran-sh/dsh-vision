/**
 * Client service-injection regressions for the rc.1 split-client runtime.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { SETTINGS_CARD_SERVICES } from '../src/client/index.ts'
import {
  resolveCredentials,
  type ImageMindClientContext,
  type RemoteCredentials,
} from '../src/client/settings/transport.ts'

function credentialsFace(): RemoteCredentials {
  return {
    set: async () => ({ ok: true }),
    describe: async () => ({ ok: true, value: {} }),
  }
}

describe('settings card client injection', () => {
  it('requests every service the controller reads from its scoped context', () => {
    expect(SETTINGS_CARD_SERVICES).toEqual(['slots', 'remote', 'settingsScope'])
  })
})

describe('credential-face resolution', () => {
  it('prefers the non-throwing context lookup over the injected getter', () => {
    const credentials = credentialsFace()
    const ctx = {
      get: (service: string) => service === 'remote' ? { credentials } : undefined,
      get remote(): never {
        throw new Error('service remote is not injected')
      },
    } as ImageMindClientContext

    expect(resolveCredentials(ctx)).toBe(credentials)
  })

  it('degrades to unavailable when an unbound injected getter throws', () => {
    const ctx = {
      get: () => undefined,
      get remote(): never {
        throw new Error('service remote is not injected')
      },
    } as ImageMindClientContext

    expect(resolveCredentials(ctx)).toBeUndefined()
  })

  it('uses the injected credential face when no context lookup exists', () => {
    const credentials = credentialsFace()
    const ctx: ImageMindClientContext = { remote: { credentials } }

    expect(resolveCredentials(ctx)).toBe(credentials)
  })
})
