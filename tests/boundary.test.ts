/**
 * Package import-boundary test: the dependency direction must be
 * image-mind → vision, never vision → image-mind. The vision service package
 * is provider-neutral and must not reference any image-mind module, provider
 * catalog, credential, attachment, client, or OpenAI wire protocol.
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

describe('package import boundaries', () => {
  it('vision (service) never imports image-mind or provider-specific modules', () => {
    const visionSources = sources(visionRoot).filter(file => !/[/\\]tests[/\\]/.test(file))
    const text = visionSources.map(file => readFileSync(file, 'utf8')).join('\n')
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

  it('vision imports only the cordis runtime and its own modules', () => {
    const visionSources = sources(visionRoot).filter(file => !/[/\\]tests[/\\]/.test(file))
    const text = visionSources.map(file => readFileSync(file, 'utf8')).join('\n')
    // No @deepseek-ai/* business packages (settings/credentials/tools), no
    // @ran-sh/dsh-vision sibling packages.
    expect(text).not.toMatch(/from '@deepseek-ai\/dsh-(settings|credentials|tools|attachment|client)/)
    expect(text).not.toMatch(/from '@ran-sh\//)
    // Only cordis + schemastery-style externals allowed.
    expect(text).toMatch(/from '@deepseek-ai\/cordis'/)
  })

  it('image-mind imports the vision service (allowed direction)', () => {
    const imageMindSources = sources(imageMindRoot).filter(file => !/[/\\]tests[/\\]/.test(file))
    const text = imageMindSources.map(file => readFileSync(file, 'utf8')).join('\n')
    expect(text).toMatch(/from '@ran-sh\/dsh-vision'/)
  })
})
