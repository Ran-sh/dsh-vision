/**
 * Real-endpoint connectivity test for the two hosted plans this deployment
 * uses (opencode-go and commandcode-goat). Reads the credentials from the DSH
 * credential document (`~/.dsh/.credentials.yaml`) at runtime — never from
 * source, never printed — and resolves them through the same key seam a real
 * call uses.
 *
 * Self-skips without `RUN_VISION_E2E=1` so `npm test` stays keyless.
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { resolveApiKey } from '../src/credentials/resolve.ts'
import { OpenAICompatibleVisionAdapter } from '../src/adapters/openai-compatible/adapter.ts'
import { createVisionCache } from '../src/cache/vision-cache.ts'
import type { VisionConnection } from '../src/runtime/types.ts'
import type { VisionRuntime } from '../src/runtime/index.ts'

const RUN = process.env['RUN_VISION_E2E'] === '1'

/** A tiny 1x1 red PNG (69 bytes) used as the probe image. */
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

/** Read one key from the DSH credential document without printing it. */
function credentialFromFile(name: string): string | undefined {
  const candidates = [
    join(homedir(), '.dsh', '.credentials.yaml'),
    join(homedir(), '.dsh', '.credentials.yml'),
  ]
  for (const path of candidates) {
    try {
      const text = readFileSync(path, 'utf8')
      const match = new RegExp(`^\\s*${name}\\s*:\\s*["']?([^"'\r\n]+)["']?\\s*$`, 'm').exec(text)
      if (match !== null) return match[1].trim()
    } catch {
      // Try the next candidate path.
    }
  }
  return undefined
}

function runCase(providerId: string, baseURL: string, model: string, apiKeyEnv: string): () => Promise<void> {
  return async () => {
    const ctx = new Context()
    // Layer the stored credential into the launch environment so the key seam
    // resolves exactly like a real deployment (never printed).
    const stored = credentialFromFile(apiKeyEnv)
    expect(stored, `credential ${apiKeyEnv} must be present in the DSH credential document`).toBeDefined()
    process.env[apiKeyEnv] = stored
    const config = resolveConfig({
      providers: { [providerId]: { baseURL, model, apiKeyEnv } },
      active: providerId,
    })
    const provider = config.providers[providerId]
    const connection: VisionConnection = {
      provider: providerId,
      baseURL: provider.baseURL,
      model: provider.model,
      apiStyle: provider.apiStyle,
      maxOutputTokens: provider.maxOutputTokens,
      timeoutMs: 30_000,
      apiKeyEnv,
    }
    const apiKey = await resolveApiKey(ctx, connection)
    expect(apiKey.length).toBeGreaterThan(0)
    const adapter = new OpenAICompatibleVisionAdapter({ resolveApiKey: async () => apiKey, cache: createVisionCache() })
    const result = await adapter.call({
      provider: providerId,
      prompt: 'Reply with exactly one short word: OK',
      images: [{ bytes: Buffer.from(TEST_IMAGE_BASE64, 'base64'), mimeType: 'image/png' }],
    }, connection)
    expect(result.text.trim()).not.toHaveLength(0)
    // The key must never appear in the answer or any thrown message.
    expect(result.text).not.toContain(stored)
  }
}

describe.skipIf(!RUN)('real-endpoint vision connectivity', () => {
  it('opencode-go answers over the new adapter', runCase('opencode-go', 'https://opencode.ai/zen/go/v1', 'mimo-v2.5', 'OPENCODE_GO_API_KEY'), 40_000)
  it('commandcode-goat answers over the new adapter', runCase('commandcode-goat', 'https://api.commandcode.ai/provider/v1', 'xiaomi/mimo-v2.5', 'COMMANDCODE_API_KEY'), 40_000)
})

describe.skipIf(!RUN)('real-endpoint composition (apply + runtime)', () => {
  /** Mount apply() with both providers and the given active, via the launch env. */
  function mountComposition(active: string): { vision: VisionRuntime } {
    const storedA = credentialFromFile('OPENCODE_GO_API_KEY')
    const storedB = credentialFromFile('COMMANDCODE_API_KEY')
    expect(storedA, 'OPENCODE_GO_API_KEY must be present').toBeDefined()
    expect(storedB, 'COMMANDCODE_API_KEY must be present').toBeDefined()
    process.env['OPENCODE_GO_API_KEY'] = storedA
    process.env['COMMANDCODE_API_KEY'] = storedB
    const ctx = new Context()
    ctx.provide('tools', { register: () => () => {} } as never)
    apply(ctx, {
      providers: {
        'opencode-go': { baseURL: 'https://opencode.ai/zen/go/v1', model: 'mimo-v2.5', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
        'commandcode-goat': { baseURL: 'https://api.commandcode.ai/provider/v1', model: 'xiaomi/mimo-v2.5', apiKeyEnv: 'COMMANDCODE_API_KEY' },
      },
      active,
    })
    const vision = ctx.get('vision') as VisionRuntime
    expect(vision).toBeDefined()
    return { vision }
  }

  const PROBE = { prompt: 'Reply with exactly one short word: OK', images: [{ bytes: Buffer.from(TEST_IMAGE_BASE64, 'base64'), mimeType: 'image/png' as const }] }

  it('active = opencode-go → omitted provider call goes to opencode-go', async () => {
    const { vision } = mountComposition('opencode-go')
    const result = await vision.call({ ...PROBE, signal: AbortSignal.timeout(30_000) })
    expect(result.provider).toBe('opencode-go')
    expect(result.model).toBe('mimo-v2.5')
    expect(result.text.trim()).not.toHaveLength(0)
  }, 40_000)

  it('active = commandcode-goat → omitted provider call goes to commandcode-goat', async () => {
    const { vision } = mountComposition('commandcode-goat')
    const result = await vision.call({ ...PROBE, signal: AbortSignal.timeout(30_000) })
    expect(result.provider).toBe('commandcode-goat')
    expect(result.model).toBe('xiaomi/mimo-v2.5')
    expect(result.text.trim()).not.toHaveLength(0)
  }, 40_000)

  it('explicit provider override beats the active', async () => {
    const { vision } = mountComposition('opencode-go')
    const result = await vision.call({ ...PROBE, provider: 'commandcode-goat', signal: AbortSignal.timeout(30_000) })
    expect(result.provider).toBe('commandcode-goat')
    expect(result.text.trim()).not.toHaveLength(0)
  }, 40_000)

  it('model override actually reaches the endpoint', async () => {
    const { vision } = mountComposition('opencode-go')
    // kimi-k3 is a second vision-capable model on the same opencode-go plan
    // (both are in the plan's known-vision list), so the override differs
    // from the configured default and the result.model echo proves the
    // override path reached the wire — no new/paid model is called.
    const result = await vision.call({ ...PROBE, model: 'kimi-k3', signal: AbortSignal.timeout(30_000) })
    expect(result.model).toBe('kimi-k3')
    expect(result.text.trim()).not.toHaveLength(0)
  }, 40_000)
})
