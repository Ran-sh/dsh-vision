/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import type { ResolvedConfig, ResolvedProvider } from '../src/config.ts'
import { automaticProviderFallbacks, MAX_AUTOMATIC_PROVIDER_FALLBACKS } from '../src/runtime/provider-fallback.ts'

const provider = (baseURL: string, model = 'vision'): ResolvedProvider => ({
  baseURL,
  model,
  apiKey: undefined,
  apiKeyEnv: undefined,
  apiStyle: 'chat-completions',
  maxOutputTokens: 512,
})

function config(): ResolvedConfig {
  return {
    providers: {
      primary: provider('https://a.example/v1'),
      incomplete: provider('', ''),
      backup1: provider('https://b.example/v1'),
      backup2: provider('https://c.example/v1'),
      backup3: provider('https://d.example/v1'),
    },
    active: 'primary',
    defaultPrompt: 'describe',
    maxBytes: 10 * 1024 * 1024,
    timeoutMs: 60_000,
    renderImagePreview: true,
    allowPrivateNetwork: false,
  }
}

describe('automatic provider fallback policy', () => {
  it('uses complete configured providers in stable order with a hard ceiling', () => {
    expect(automaticProviderFallbacks(config(), 'primary', {})).toEqual(['backup1', 'backup2'])
    expect(MAX_AUTOMATIC_PROVIDER_FALLBACKS).toBe(2)
  })

  it('does not reroute an explicit provider selection', () => {
    expect(automaticProviderFallbacks(config(), 'primary', { provider: 'primary' })).toEqual([])
  })

  it('does not reroute an explicit model selection', () => {
    expect(automaticProviderFallbacks(config(), 'primary', { model: 'special-model' })).toEqual([])
  })

  it('never returns the primary or incomplete providers', () => {
    const result = automaticProviderFallbacks(config(), 'backup1', {})
    expect(result).not.toContain('backup1')
    expect(result).not.toContain('incomplete')
    expect(result).toEqual(['primary', 'backup2'])
  })
})
