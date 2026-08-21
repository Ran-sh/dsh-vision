/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_OUTPUT_TOKENS, resolveProvider } from '../src/config.ts'

describe('default provider output cap', () => {
  it('does not flatten compare/OCR task budgets to the historical 1024 limit', () => {
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(3000)
    expect(resolveProvider('p', {
      baseURL: 'https://example.invalid/v1',
      model: 'vision-model',
      apiKeyEnv: 'VISION_API_KEY',
    }).maxOutputTokens).toBe(3000)
  })

  it('still honors an explicitly lower user hard cap', () => {
    expect(resolveProvider('p', {
      baseURL: 'https://example.invalid/v1',
      model: 'vision-model',
      apiKeyEnv: 'VISION_API_KEY',
      maxOutputTokens: 1024,
    }).maxOutputTokens).toBe(1024)
  })
})
