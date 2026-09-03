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

/**
 * Minimal node-semver-compatible admission check for `^M.m.p-pre` ranges (the
 * only shape used by this project's peer policy). Mirroring node-semver,
 * prerelease candidates must share the range's [major, minor, patch] tuple;
 * release candidates only need the plain numeric bounds.
 */
function rangeAdmits(version: string, range: string): boolean {
  interface Ver { major: number; minor: number; patch: number; pre: string[] }

  const parse = (v: string): Ver => {
    const [core, pre = ''] = v.split('-')
    const [major, minor, patch] = core.split('.').map(Number)
    return { major, minor, patch, pre: pre ? pre.split('.') : [] }
  }

  const cmp = (a: Ver, b: Ver): number => {
    if (a.major !== b.major) return a.major - b.major
    if (a.minor !== b.minor) return a.minor - b.minor
    if (a.patch !== b.patch) return a.patch - b.patch
    if (a.pre.length === 0 && b.pre.length === 0) return 0
    if (a.pre.length === 0) return 1 // release > prerelease
    if (b.pre.length === 0) return -1
    const max = Math.max(a.pre.length, b.pre.length)
    for (let i = 0; i < max; i++) {
      const pa = a.pre[i], pb = b.pre[i]
      if (pa === undefined) return -1
      if (pb === undefined) return 1
      const na = /^\d+$/.test(pa), nb = /^\d+$/.test(pb)
      const d = na && nb ? Number(pa) - Number(pb) : na ? -1 : nb ? 1 : pa < pb ? -1 : pa > pb ? 1 : 0
      if (d !== 0) return d
    }
    return 0
  }

  const lower = parse(range.replace(/^\^/, ''))
  const upper: Ver = lower.major > 0
    ? { major: lower.major + 1, minor: 0, patch: 0, pre: [] }
    : lower.minor > 0
      ? { major: 0, minor: lower.minor + 1, patch: 0, pre: [] }
      : { major: 0, minor: 0, patch: lower.patch + 1, pre: [] }
  const v = parse(version)
  if (cmp(v, lower) < 0 || cmp(v, upper) >= 0) return false
  if (lower.pre.length > 0 && v.pre.length > 0) {
    if (v.major !== lower.major || v.minor !== lower.minor || v.patch !== lower.patch) return false
  }
  return true
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

  it('is exactly the 0.3.2/0.3.3 adaptation candidate pair', () => {
    expect(pkg['version']).toBe('0.3.3')
    const visionPkg = readJson(resolve(VISION_DIR, 'package.json'))
    expect(visionPkg['version']).toBe('0.3.2')
  })

  it('depends on the compatible service range @ran-sh/dsh-vision@^0.3.2 (admission API)', () => {
    const dependencies = pkg['dependencies'] as Record<string, string>
    expect(dependencies['@ran-sh/dsh-vision']).toBe('^0.3.2')
  })

  it('declares a prepack fail-safe guard covering every shipped lib entry', () => {
    expect(pkg['scripts']?.['prepack']).toContain('pack-guard.mjs')
    const guard = pkg['packGuard'] as { entries: string[]; inputs: string[] }
    expect(guard.entries).toEqual(['lib/index.js', 'lib/client.js', 'lib/cli.js'])
    expect(guard.inputs).toContain('src')
    const visionPkg = readJson(resolve(VISION_DIR, 'package.json'))
    expect(visionPkg['scripts']?.['prepack']).toContain('pack-guard.mjs')
    const visionGuard = visionPkg['packGuard'] as { entries: string[] }
    // The defective public 0.2.0 shipped ONLY metadata files (2/3 entries);
    // these required-entry lists are the incident regression contract.
    expect(visionGuard.entries).toEqual(['lib/index.js', 'lib/types/index.d.ts'])
  })

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

  it('exports the node entry, the client bundle and the lifecycle CLI bin', () => {
    const exportsMap = pkg['exports'] as Record<string, unknown>
    expect(exportsMap['.']).toBeDefined()
    expect(exportsMap['./client']).toBeDefined()
    expect(Object.keys(exportsMap).some(key => key.includes('/src/'))).toBe(false)
  })

  it('ships lib (index/client/cli), bundle patch, and README — never tests, credentials, or src', () => {
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

describe('peer dependency ranges admit the exact 0.1.2-rc.1 harness line', () => {
  const imageMindPkg = readJson(resolve(IMAGE_MIND_DIR, 'package.json'))
  const imageMindPeer = imageMindPkg['peerDependencies'] as Record<string, string>
  const visionPeer = (readJson(resolve(VISION_DIR, 'package.json'))['peerDependencies']) as Record<string, string>

  it('image-mind peers admit the official 0.1.2-rc.1 family and reject the stale rc.2 line', () => {
    const hostPeers = Object.entries(imageMindPeer).filter(([name]) => name !== '@deepseek-ai/cordis')
    expect(hostPeers.length).toBeGreaterThan(0)
    for (const [name, range] of hostPeers) {
      expect(rangeAdmits('0.1.2-rc.1', range), `${name} ${range} rejects the 0.1.2-rc.1 line`).toBe(true)
      expect(rangeAdmits('0.1.1-rc.2', range), `${name} ${range} admits the older 0.1.1-rc.2`).toBe(false)
      expect(rangeAdmits('0.2.0', range), `${name} ${range} admits 0.2.0`).toBe(false)
    }
    expect(imageMindPeer['@deepseek-ai/dsh-client-runtime']).toBeUndefined()
  })

  it('the vision service peer admits the 0.1.2-rc.1 dsh-llm line', () => {
    expect(rangeAdmits('0.1.2-rc.1', visionPeer['@deepseek-ai/dsh-llm'])).toBe(true)
    expect(rangeAdmits('0.1.1-rc.2', visionPeer['@deepseek-ai/dsh-llm'])).toBe(false)
  })
})

describe('npm pack output (both packages) — the empty-shell 0.2.0 incident must never repeat', () => {
  it('dsh-plugin-image-mind tarball contains the runtime pieces and nothing private', () => {
    const files = packFiles(IMAGE_MIND_DIR)
    expect(files).toContain('package.json')
    expect(files).toContain('lib/index.js')
    expect(files).toContain('lib/client.js')
    expect(files).toContain('lib/cli.js')
    expect(files).toContain('cordis.patch.yml')
    expect(files).toContain('README.md')
    // The defective public 0.2.0 shipped exactly 3 metadata-only entries;
    // a regression below this floor means lib/** was missing at pack time.
    expect(files.length).toBeGreaterThan(6)
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
    // The defective public 0.2.0 shipped exactly 2 metadata-only entries.
    expect(files.length).toBeGreaterThan(4)
    expect(files.some(entry => /(^|\/)tests\//.test(entry))).toBe(false)
    expect(files.some(entry => /(^|\/)src\//.test(entry))).toBe(false)
    expect(files.some(entry => /\.credentials\.ya?ml$/.test(entry))).toBe(false)
  })
})

describe('declared-minimum service dependency compose (R2C-4 semver/API identity)', () => {
  const visionPkg = readJson(resolve(VISION_DIR, 'package.json'))
  const pluginPkg = readJson(resolve(IMAGE_MIND_DIR, 'package.json'))

  it('the plugin declares a service range whose minimum carries the admission() API', () => {
    // R2B added `admission()` to @ran-sh/dsh-vision's VisionCircuitBreaker and
    // image-mind calls it directly, so the declared dependency minimum must be
    // a version that actually ships that API — never an older published one.
    const range = pluginPkg['dependencies']?.['@ran-sh/dsh-vision'] as string
    expect(range).toBe('^0.3.2')
    expect(rangeAdmits('0.3.2', range)).toBe(true)
    // The previously published 0.3.1 (no admission API) must NOT satisfy the
    // declared range.
    expect(rangeAdmits('0.3.1', range)).toBe(false)
  })

  it('the workspace vision version carries the API the plugin source calls', () => {
    expect(visionPkg['version']).toBe('0.3.2')
    const pluginSrc = readFileSync(resolve(IMAGE_MIND_DIR, 'src/runtime/provider-reliability.ts'), 'utf8')
    expect(pluginSrc).toContain('.admission(')
  })
})
