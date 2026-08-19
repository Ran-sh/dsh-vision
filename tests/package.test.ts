/**
 * Package/bundle integrity tests (`npm run test:package`): prove the plugin
 * PUBLISHING unit is complete without touching any user profile — package.json
 * metadata (bundle patch, client inject, dependency closure), the cordis patch
 * content, and the actual npm pack output for both workspace packages. Nothing
 * here installs, writes, or mutates a DSH profile.
 * @vitest-environment node
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')
const IMAGE_MIND_DIR = resolve(ROOT, 'packages/image-mind')
const VISION_DIR = resolve(ROOT, 'packages/vision')

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

/** Run `npm pack --dry-run --json` in a package dir and parse the file list. */
function packFiles(pkgDir: string): string[] {
  // `npm` on Windows resolves through npm.cmd, so run through the shell.
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkgDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>
  return parsed.flatMap(entry => entry.files.map(file => file.path))
}

describe('dsh-plugin-image-mind package metadata', () => {
  const pkg = readJson(resolve(IMAGE_MIND_DIR, 'package.json'))

  it('declares the bundle patch and the patch file exists', () => {
    const dsh = pkg['dsh'] as Record<string, unknown>
    const bundle = dsh['bundle'] as Record<string, unknown>
    expect(bundle['patch']).toBe('./cordis.patch.yml')
    expect(existsSync(resolve(IMAGE_MIND_DIR, 'cordis.patch.yml'))).toBe(true)
  })

  it('declares the web client injection surface', () => {
    const dsh = pkg['dsh'] as Record<string, unknown>
    const client = dsh['client'] as Record<string, unknown>
    expect(client['platform']).toBe('web')
    const inject = client['inject']
    expect(Array.isArray(inject)).toBe(true)
    expect((inject as string[]).length).toBeGreaterThan(0)
  })

  it('dependency closure: @ran-sh/dsh-vision is a real dependency (not only a workspace accident)', () => {
    const dependencies = pkg['dependencies'] as Record<string, unknown>
    expect(dependencies['@ran-sh/dsh-vision']).toBeDefined()
  })

  it('exports the node entry and the client bundle, never ./src/*', () => {
    const exportsMap = pkg['exports'] as Record<string, unknown>
    expect(exportsMap['.']).toBeDefined()
    expect(exportsMap['./client']).toBeDefined()
    expect(Object.keys(exportsMap).some(key => key.includes('/src/'))).toBe(false)
  })

  it('ships lib, bundle patch, and README — never tests, credentials, or src', () => {
    const files = pkg['files'] as string[]
    expect(files).toContain('lib/**/*.js')
    expect(files).toContain('cordis.patch.yml')
    expect(files.some(entry => entry.includes('test'))).toBe(false)
    expect(files.some(entry => entry.includes('src'))).toBe(false)
  })
})

describe('cordis bundle patch content', () => {
  const patch = readFileSync(resolve(IMAGE_MIND_DIR, 'cordis.patch.yml'), 'utf8')

  it('inserts the vision service row and the image-mind provider row', () => {
    expect(patch).toContain('- id: vision-runtime')
    expect(patch).toContain("name: '@ran-sh/dsh-vision'")
    expect(patch).toContain('- id: image-mind')
    expect(patch).toContain('name: dsh-plugin-image-mind')
  })

  it('uses block insert rows only (the past flow-style [] bug must not return)', () => {
    expect(patch).not.toMatch(/\n\s*\[\s*\n/)
    expect(patch).toContain('- insert:')
  })
})

describe('@ran-sh/dsh-vision package metadata', () => {
  const pkg = readJson(resolve(VISION_DIR, 'package.json'))

  it('exports only the runtime entry and types, never ./src/*', () => {
    const exportsMap = pkg['exports'] as Record<string, unknown>
    expect(exportsMap['.']).toBeDefined()
    expect(Object.keys(exportsMap).some(key => key.includes('/src/'))).toBe(false)
  })

  it('keeps the provider-neutral service surface (peer deps only)', () => {
    const peer = pkg['peerDependencies'] as Record<string, unknown>
    expect(peer['@deepseek-ai/cordis']).toBeDefined()
    expect(peer['@deepseek-ai/dsh-llm']).toBeDefined()
  })
})

describe('npm pack output (both packages)', () => {
  it('dsh-plugin-image-mind tarball contains the runtime pieces and nothing private', () => {
    const files = packFiles(IMAGE_MIND_DIR)
    expect(files).toContain('package.json')
    expect(files).toContain('lib/index.js')
    expect(files).toContain('lib/client.js')
    expect(files).toContain('cordis.patch.yml')
    expect(files).toContain('README.md')
    expect(files.some(entry => /(^|\/)tests\//.test(entry))).toBe(false)
    expect(files.some(entry => /(^|\/)src\//.test(entry))).toBe(false)
    expect(files.some(entry => /\.credentials\.ya?ml$/.test(entry))).toBe(false)
    expect(files.some(entry => /(^|\/)\.env$/.test(entry))).toBe(false)
    expect(files.some(entry => /(^|\/)node_modules\//.test(entry))).toBe(false)
  })

  it('@ran-sh/dsh-vision tarball contains lib + types and nothing private', () => {
    const files = packFiles(VISION_DIR)
    expect(files).toContain('package.json')
    expect(files).toContain('lib/index.js')
    expect(files.some(entry => /^lib\/types\/.*\.d\.ts$/.test(entry))).toBe(true)
    expect(files).toContain('README.md')
    expect(files.some(entry => /(^|\/)tests\//.test(entry))).toBe(false)
    expect(files.some(entry => /(^|\/)src\//.test(entry))).toBe(false)
    expect(files.some(entry => /\.credentials\.ya?ml$/.test(entry))).toBe(false)
  })
})
