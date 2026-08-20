/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { ImageMindVisionError } from '../src/adapters/openai-compatible/adapter.ts'

describe('vision HTTP retry classification', () => {
  it('does not retry deterministic provider 4xx responses', () => {
    expect(new ImageMindVisionError('bad request', 'PROVIDER_ERROR', { status: 400 }).retryable).toBe(false)
    expect(new ImageMindVisionError('not found', 'PROVIDER_ERROR', { status: 404 }).retryable).toBe(false)
    expect(new ImageMindVisionError('unprocessable', 'PROVIDER_ERROR', { status: 422 }).retryable).toBe(false)
  })

  it('keeps transient failures retryable', () => {
    expect(new ImageMindVisionError('rate limited', 'RATE_LIMITED', { status: 429 }).retryable).toBe(true)
    expect(new ImageMindVisionError('server', 'PROVIDER_ERROR', { status: 503 }).retryable).toBe(true)
    expect(new ImageMindVisionError('network', 'NETWORK_ERROR').retryable).toBe(true)
    expect(new ImageMindVisionError('timeout', 'TIMEOUT').retryable).toBe(true)
  })
})
