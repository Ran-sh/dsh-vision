/**
 * Model discovery tests: /models listing, missing key, invalid baseURL,
 * custom provider fallback, and keyless providers.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverEndpointModels, planVisionModels } from '../src/adapters/openai-compatible/discovery.ts'
import type { VisionConnection } from '../src/runtime/types.ts'

function connection(overrides: Partial<VisionConnection> = {}): VisionConnection {
  return {
    provider: 'p',
    baseURL: 'https://api.example.com/v1',
    model: 'm',
    apiStyle: 'chat-completions',
    maxOutputTokens: 1024,
    timeoutMs: 10_000,
    ...overrides,
  }
}

function modelsResponse(ids: string[]): Partial<Response> & { ok: boolean; status: number } {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ data: ids.map(id => ({ id })) })))
        controller.close()
      },
    }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('discoverEndpointModels', () => {
  it('lists endpoint models (known-plan list leads)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => modelsResponse(['m1', 'm2'])))
    const outcome = await discoverEndpointModels(connection(), 'sk')
    expect(outcome.source).toBe('endpoint')
    // The generic plan list leads (baseURL matches no known plan), then the
    // endpoint's own models follow sorted.
    const plan = planVisionModels('https://api.example.com/v1')
    expect(outcome.models.slice(0, plan.length).map(m => m.id)).toEqual([...plan])
    expect(outcome.models.map(m => m.id)).toContain('m1')
    expect(outcome.models.map(m => m.id)).toContain('m2')
  })

  it('falls back to the plan list when the endpoint rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, body: null })))
    const outcome = await discoverEndpointModels(connection(), 'sk')
    expect(outcome.source).toBe('fallback')
    expect(outcome.reason).toMatch(/401/)
    expect(outcome.models.length).toBeGreaterThan(0)
  })

  it('falls back on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const outcome = await discoverEndpointModels(connection(), 'sk')
    expect(outcome.source).toBe('fallback')
    expect(outcome.models.length).toBeGreaterThan(0)
  })

  it('falls back on a non-OpenAI shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"weird": true}'))
          controller.close()
        },
      }),
    })))
    const outcome = await discoverEndpointModels(connection(), 'sk')
    expect(outcome.source).toBe('fallback')
    expect(outcome.reason).toMatch(/OpenAI/)
  })

  it('falls back on an empty model list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => modelsResponse([])))
    const outcome = await discoverEndpointModels(connection(), 'sk')
    expect(outcome.source).toBe('fallback')
    expect(outcome.reason).toMatch(/没有返回任何模型/)
  })

  it('promotes known-plan models above the endpoint roster', async () => {
    const plan = planVisionModels('https://opencode.ai/zen/go/v1')
    vi.stubGlobal('fetch', vi.fn(async () => modelsResponse(['other-model', ...plan])))
    const outcome = await discoverEndpointModels(connection({ baseURL: 'https://opencode.ai/zen/go/v1' }), 'sk')
    expect(outcome.source).toBe('endpoint')
    // The plan leads; the extra follows sorted.
    expect(outcome.models.slice(0, plan.length).map(m => m.id)).toEqual([...plan])
  })

  it('works with an empty key for keyless endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => modelsResponse(['llava'])))
    const outcome = await discoverEndpointModels(connection({ baseURL: 'http://localhost:11434/v1' }), '')
    expect(outcome.source).toBe('endpoint')
    // The localhost plan leads; the endpoint's own `llava` is among them.
    expect(outcome.models.map(m => m.id)).toContain('llava')
  })
})
