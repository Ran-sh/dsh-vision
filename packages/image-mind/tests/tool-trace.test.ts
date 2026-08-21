/** @vitest-environment node */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { understandImageRoute, understandImageTool } from '../src/tools/understand-image.ts'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

describe('understand_image diagnostics passthrough', () => {
  it('keeps execution trace, token usage, selected route, and route decisions in the structured tool result', async () => {
    const ctx = new Context()
    const trace = {
      providerCalls: 3,
      payloadBytes: 12345,
      cacheHits: 0,
      retries: 1,
      modelFallbacks: 0,
      providerFallbacks: 1,
      splits: 0,
    }
    const usage = { inputTokens: 4321, outputTokens: 210 }
    ctx.provide('vision', {
      call: vi.fn(async () => ({ text: 'answer', provider: 'backup', model: 'vision', trace, usage })),
    } as never)
    ctx.provide('attachments', {} as never)

    const dir = mkdtempSync(join(tmpdir(), 'dsh-vision-trace-'))
    const file = join(dir, 'img.png')
    writeFileSync(file, PNG)

    const tool = understandImageTool(ctx, () => 'describe', () => ({ maxBytes: 1024 * 1024, allowPrivateNetwork: false }))
    const result = await tool.execute({ image: file }, { signal: new AbortController().signal } as never)

    expect(result.trace).toEqual(trace)
    expect(result.usage).toEqual(usage)
    expect(result.provider).toBe('backup')
    expect(result.route).toEqual({
      source: 'provider',
      task: 'general',
      cacheMode: 'use',
      evidenceLayerEnabled: false,
      selectedProvider: 'backup',
      selectedModel: 'vision',
      modelFallback: false,
      providerFallback: true,
    })
    expect(result.text).toBe('answer')
  })

  it('marks zero-call runtime cache hits as semantic-cache and preserves explicit intent', () => {
    const trace = {
      providerCalls: 0,
      payloadBytes: 0,
      cacheHits: 1,
      retries: 0,
      modelFallbacks: 0,
      providerFallbacks: 0,
      splits: 0,
    }

    expect(understandImageRoute(
      { provider: ' primary ', model: ' vision-v1 ' },
      'primary',
      'vision-v1',
      { task: 'ocr', cacheMode: 'use', evidenceLayerEnabled: false },
      trace,
    )).toEqual({
      source: 'semantic-cache',
      task: 'ocr',
      cacheMode: 'use',
      evidenceLayerEnabled: false,
      requestedProvider: 'primary',
      requestedModel: 'vision-v1',
      selectedProvider: 'primary',
      selectedModel: 'vision-v1',
      modelFallback: false,
      providerFallback: false,
    })
  })

  it('distinguishes layered reusable evidence from the runtime semantic cache', () => {
    const trace = {
      providerCalls: 0,
      payloadBytes: 0,
      cacheHits: 1,
      retries: 0,
      modelFallbacks: 0,
      providerFallbacks: 0,
      splits: 0,
    }

    expect(understandImageRoute(
      {},
      'cached-provider',
      'cached-model',
      { task: 'ocr', cacheMode: 'use', evidenceLayerEnabled: true },
      trace,
      'evidence-cache',
    )).toEqual({
      source: 'evidence-cache',
      task: 'ocr',
      cacheMode: 'use',
      evidenceLayerEnabled: true,
      selectedProvider: 'cached-provider',
      selectedModel: 'cached-model',
      modelFallback: false,
      providerFallback: false,
    })
  })
})
