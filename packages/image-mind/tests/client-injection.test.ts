/**
 * Client service-injection regressions for the rc.1 split-client runtime.
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { SETTINGS_CARD_SERVICES } from '../src/client/index.ts'
import { ImageMindSettingsCardController } from '../src/client/settings-card.tsx'
import {
  resolveCredentials,
  resolveScope,
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

describe('settings-scope resolution', () => {
  it('prefers the non-throwing context lookup over the injected getter', () => {
    const scope = {}
    const ctx = {
      get: (service: string) => service === 'settingsScope'
        ? { bind: () => scope }
        : undefined,
      get settingsScope(): never {
        throw new Error('service settingsScope is not injected')
      },
    } as ImageMindClientContext

    expect(resolveScope(ctx)).toBe(scope)
  })

  it('degrades to unavailable when an unbound injected getter throws', () => {
    const ctx = {
      get: () => undefined,
      get settingsScope(): never {
        throw new Error('service settingsScope is not injected')
      },
    } as ImageMindClientContext

    expect(resolveScope(ctx)).toBeUndefined()
  })

  it('keeps the settings controller unavailable instead of throwing on an unbound getter', () => {
    const ctx = {
      get: () => undefined,
      get settingsScope(): never {
        throw new Error('service settingsScope is not injected')
      },
    } as ImageMindClientContext

    expect(() => {
      const controller = new ImageMindSettingsCardController(ctx as never)
      expect(controller.inject().hooks.imageMindSettingsCard.getSnapshot().transport).toBe('unavailable')
      controller.dispose()
    }).not.toThrow()
  })

  it('keeps the settings controller unavailable when scope binding fails', () => {
    const ctx = {
      get: () => ({
        bind: () => { throw new Error('settings scope bind failed') },
      }),
    } as ImageMindClientContext

    expect(() => {
      const controller = new ImageMindSettingsCardController(ctx as never)
      expect(controller.inject().hooks.imageMindSettingsCard.getSnapshot().transport).toBe('unavailable')
      controller.dispose()
    }).not.toThrow()
  })

  it('keeps the official controller path and binds its scope exactly once', () => {
    const scope = {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: {},
        base: undefined,
        user: {},
        revision: 1,
        writable: true,
      }),
      subscribe: () => () => {},
      mutate: async () => {},
    }
    const bind = vi.fn(() => scope)
    const ctx = {
      get: (service: string) => service === 'settingsScope' ? { bind } : undefined,
    } as ImageMindClientContext

    const controller = new ImageMindSettingsCardController(ctx as never)
    expect(controller.inject().hooks.imageMindSettingsCard.getSnapshot().transport).toBe('official')
    expect(bind).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
})
