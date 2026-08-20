/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { VisionRuntime } from '../src/runtime.ts'
import { VisionError } from '../src/errors.ts'
import type { VisionAdapter } from '../src/adapter.ts'
import type { VisionRequestLifecycleEvent } from '../src/events.ts'
import type { VisionRequest, VisionResult, VisionTrace } from '../src/types.ts'

function trace(): VisionTrace {
  return {
    providerCalls: 1,
    payloadBytes: 123,
    cacheHits: 0,
    retries: 0,
    modelFallbacks: 0,
    providerFallbacks: 0,
    splits: 0,
  }
}

function adapter(call: (provider: string, request: VisionRequest) => Promise<VisionResult>): VisionAdapter {
  return { call } satisfies VisionAdapter
}

describe('VisionRuntime lifecycle observers', () => {
  it('emits metadata-only started/completed events with stable correlation', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['primary'], adapter(async () => ({
      text: 'provider answer must not be emitted',
      provider: 'backup',
      model: 'vision-model',
      usage: { inputTokens: 20, outputTokens: 5 },
      trace: trace(),
    })))

    const events: VisionRequestLifecycleEvent[] = []
    runtime.subscribeLifecycle(event => { events.push(event) })
    const result = await runtime.call({
      prompt: 'SECRET PROMPT: do not leak me',
      images: [{ bytes: Buffer.from('SECRET IMAGE BYTES'), mimeType: 'image/png' }],
      cache: 'refresh',
      maxOutputTokens: 777,
    })

    expect(result.provider).toBe('backup')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      phase: 'started',
      provider: 'primary',
      imageCount: 1,
      cacheMode: 'refresh',
      maxOutputTokens: 777,
      explicitProvider: false,
      explicitModel: false,
    })
    expect(events[1]).toMatchObject({
      phase: 'completed',
      provider: 'primary',
      resultProvider: 'backup',
      model: 'vision-model',
      usage: { inputTokens: 20, outputTokens: 5 },
      trace: { providerCalls: 1, payloadBytes: 123 },
    })
    expect(events[0].requestId).toBe(events[1].requestId)
    expect(Object.isFrozen(events[0])).toBe(true)
    expect(Object.isFrozen(events[1])).toBe(true)

    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('SECRET PROMPT')
    expect(serialized).not.toContain('SECRET IMAGE BYTES')
    expect(serialized).not.toContain('provider answer')
  })

  it('emits a redacted failed event with code/trace but no error message', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    runtime.registerAdapter(['a'], adapter(async () => {
      throw new VisionError('SECRET provider response body', 'PROVIDER_ERROR', { trace: trace() })
    }))
    const events: VisionRequestLifecycleEvent[] = []
    runtime.subscribeLifecycle(event => { events.push(event) })

    await expect(runtime.call({ prompt: 'OCR this', images: [] })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      phase: 'failed',
      provider: 'a',
      errorCode: 'PROVIDER_ERROR',
      aborted: false,
      trace: { providerCalls: 1 },
    })
    expect(JSON.stringify(events[1])).not.toContain('SECRET provider response body')
  })

  it('contains observer failures and supports explicit unsubscribe', async () => {
    const ctx = new Context()
    const runtime = new VisionRuntime(ctx)
    const call = vi.fn(async (provider: string) => ({ text: 'ok', provider, model: 'm' }))
    runtime.registerAdapter(['a'], adapter(call))

    runtime.subscribeLifecycle(() => { throw new Error('observer boom') })
    const seen = vi.fn()
    const dispose = runtime.subscribeLifecycle(seen)

    await expect(runtime.call({ prompt: 'describe photo', images: [] })).resolves.toMatchObject({ text: 'ok' })
    expect(call).toHaveBeenCalledOnce()
    expect(seen).toHaveBeenCalledTimes(2)

    dispose()
    await runtime.call({ prompt: 'describe photo', images: [] })
    expect(seen).toHaveBeenCalledTimes(2)
  })
})
