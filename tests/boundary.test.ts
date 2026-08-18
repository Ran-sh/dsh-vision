/**
 * Package import-boundary test: the dependency direction must be
 * image-mind → vision, never vision → image-mind. The vision service package
 * is provider-neutral and must not reference any image-mind module, provider
 * catalog, credential, attachment, client, or OpenAI wire protocol — the
 * provider-seam audit: adding a brand-new adapter family (Gemini native,
 * Anthropic, gRPC, local process) must not require touching packages/vision.
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const visionRoot = resolve(here, '../packages/vision')
const imageMindRoot = resolve(here, '../packages/image-mind')

/** Every .ts source file under a directory. */
function sources(root: string): string[] {
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
    }
  }
  walk(root)
  return out
}

/** Every production source file of the vision service package. */
const visionProductionSources = (): string[] =>
  sources(visionRoot).filter(file => !/[/\\]tests[/\\]/.test(file))

describe('package import boundaries', () => {
  it('vision (service) never imports image-mind or provider-specific modules', () => {
    const text = visionProductionSources().map(file => readFileSync(file, 'utf8')).join('\n')
    // image-mind / provider-specific references must not appear in vision src.
    for (const forbidden of [
      'image-mind',
      'imageMind',
      'providers/catalog',
      'openai-compatible',
      'OpenAICompatible',
      'credentials/resolve',
      'credentials/migrate',
      'attachments/',
      'client/',
      'OPENCODE',
      'COMMANDCODE',
      'understand_image',
    ]) {
      expect(text, `vision must not reference ${forbidden}`).not.toMatch(forbidden)
    }
  })

  it('vision imports only the cordis runtime, the official error base, and its own modules', () => {
    const text = visionProductionSources().map(file => readFileSync(file, 'utf8')).join('\n')
    // No @deepseek-ai/* business packages (settings/credentials/tools), no
    // @ran-sh/dsh-vision sibling packages. The shared harness error base
    // (@deepseek-ai/dsh-llm's public HarnessError) is the one official
    // exception, exactly as LlmError and WebError extend it.
    expect(text).not.toMatch(/from '@deepseek-ai\/dsh-(settings|credentials|tools|attachment|client|llm-deepseek|web-search)/)
    expect(text).not.toMatch(/from '@ran-sh\//)
    // Only cordis + the official error base allowed.
    expect(text).toMatch(/from '@deepseek-ai\/cordis'/)
    expect(text).toMatch(/HarnessError/)
  })

  it('image-mind imports the vision service (allowed direction)', () => {
    const imageMindSources = sources(imageMindRoot).filter(file => !/[/\\]tests[/\\]/.test(file))
    const text = imageMindSources.map(file => readFileSync(file, 'utf8')).join('\n')
    expect(text).toMatch(/from '@ran-sh\/dsh-vision'/)
  })
})

describe('provider-neutral seam audit (packages/vision/src)', () => {
  it('production source contains zero provider-specific vocabulary', () => {
    const text = visionProductionSources().map(file => readFileSync(file, 'utf8')).join('\n')
    // Wire protocols, vendor names, credential strategies, and endpoint facts
    // must never cross into the service package. Adding a brand-new adapter
    // family must not require touching packages/vision.
    const forbidden = [
      'chat-completions',
      'responses',
      'OpenAI',
      'apiKey',
      'apiKeyEnv',
      'inlineApiKey',
      'Authorization',
      'Bearer',
      'baseURL',
      'Bearer ',
    ]
    const matches = forbidden.filter(term => text.includes(term))
    expect(matches, `provider-specific terms leaked into packages/vision/src: ${matches.join(', ')}`).toEqual([])
  })

  it('the runtime dispatches only provider → adapter; no connection/credential/transport vocabulary', () => {
    const runtimeText = readFileSync(resolve(visionRoot, 'src/runtime.ts'), 'utf8')
    expect(runtimeText).not.toMatch(/resolveConnection|connectionResolver|VisionConnection|apiKeyEnv|baseURL|apiStyle/)
    expect(runtimeText).not.toMatch(/fetch\(|headers|authorization/i)
    // The runtime must keep the official two-argument registration shape.
    expect(runtimeText).toMatch(/registerAdapter\(providers: string\[\], adapter: VisionAdapter\)/)
  })
})
