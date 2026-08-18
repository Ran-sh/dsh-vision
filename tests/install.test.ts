/**
 * Install/uninstall smoke tests against a TEMPORARY DSH_HOME — never the
 * user's real `~/.dsh`. Proves the full `npm run install:dsh` /
 * `uninstall:dsh` flow: link creation, idempotent re-install, patch row
 * insertion/removal with other rows preserved, settings preserved by
 * default, and purge-settings removing only the image-mind section.
 * @vitest-environment node
 */

import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, lstatSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const installScript = join(projectRoot, 'scripts', 'install-dsh.mjs')
const uninstallScript = join(projectRoot, 'scripts', 'uninstall-dsh.mjs')

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-vision-install-'))
  // A realistic profile skeleton: one profile with an existing patch.
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  mkdirSync(join(home, 'profiles', 'node_modules'), { recursive: true })
  // NOTE: @ran-sh is deliberately NOT pre-created — the installer must make it.
  writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'),
    '# existing patch\n- insert:\n    - id: some-other-plugin\n      name: dsh-some-other\n')
  writeFileSync(join(home, 'settings.yaml'), 'someOther:\n  key: value\n')
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function run(script: string, extra: string[] = []): string {
  return execFileSync(process.execPath, [script, ...extra], {
    cwd: projectRoot,
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
  })
}

const patchPath = (): string => join(home, 'profiles', 'web', 'cordis.patch.yml')
const settingsPath = (): string => join(home, 'settings.yaml')
const visionLink = (): string => join(home, 'profiles', 'node_modules', '@ran-sh', 'dsh-vision')
const imageMindLink = (): string => join(home, 'profiles', 'node_modules', 'dsh-plugin-image-mind')

describe('npm run install:dsh / uninstall:dsh (temp DSH_HOME)', () => {
  it('installs: links both packages and inserts the two profile rows', () => {
    const out = run(installScript)
    expect(out).toMatch(/linked @ran-sh\/dsh-vision/)
    expect(out).toMatch(/linked dsh-plugin-image-mind/)
    expect(existsSync(visionLink())).toBe(true)
    expect(existsSync(imageMindLink())).toBe(true)
    // Both links point at THIS project's packages.
    expect(resolve(lstatSync(visionLink()).isSymbolicLink() ? require('node:fs').realpathSync(visionLink()) : visionLink())).toBe(resolve(projectRoot, 'packages', 'vision'))
    const patch = readFileSync(patchPath(), 'utf8')
    expect(patch).toMatch(/- id: vision-runtime/)
    expect(patch).toMatch(/- id: image-mind/)
    // Other rows survive.
    expect(patch).toMatch(/some-other-plugin/)
  })

  it('re-installing is idempotent: no duplicate rows, no second backup', () => {
    run(installScript)
    const backupsBefore = existsSync(join(home, 'profiles', 'web'))
      ? require('node:fs').readdirSync(join(home, 'profiles', 'web')).filter(f => f.includes('.bak-')).length
      : 0
    const out = run(installScript)
    expect(out).toMatch(/nothing to add/)
    const patch = readFileSync(patchPath(), 'utf8')
    expect(patch.match(/- id: vision-runtime/g)).toHaveLength(1)
    expect(patch.match(/- id: image-mind/g)).toHaveLength(1)
    const backupsAfter = require('node:fs').readdirSync(join(home, 'profiles', 'web')).filter(f => f.includes('.bak-')).length
    expect(backupsAfter).toBe(backupsBefore)
  })

  it('uninstalls: removes its links and rows, keeps other rows and settings', () => {
    run(installScript)
    const out = run(uninstallScript)
    expect(out).toMatch(/unlinked @ran-sh\/dsh-vision/)
    expect(out).toMatch(/unlinked dsh-plugin-image-mind/)
    expect(existsSync(visionLink())).toBe(false)
    expect(existsSync(imageMindLink())).toBe(false)
    const patch = readFileSync(patchPath(), 'utf8')
    expect(patch).not.toMatch(/vision-runtime/)
    expect(patch).not.toMatch(/image-mind/)
    expect(patch).toMatch(/some-other-plugin/)
    // Settings untouched by default.
    expect(readFileSync(settingsPath(), 'utf8')).toMatch(/someOther/)
  })

  it('--purge-settings removes only the image-mind section from settings.yaml', () => {
    writeFileSync(settingsPath(), 'someOther:\n  key: value\nimage-mind:\n  active: a\n  providers:\n    a:\n      baseURL: https://x\n')
    run(installScript)
    run(uninstallScript, ['--purge-settings'])
    const settings = readFileSync(settingsPath(), 'utf8')
    expect(settings).not.toMatch(/image-mind/)
    expect(settings).toMatch(/someOther/)
  })

  it('uninstall with nothing installed is a no-op that keeps the profile intact', () => {
    const out = run(uninstallScript)
    expect(out).toMatch(/nothing to uninstall|skip|settings kept/)
    expect(readFileSync(patchPath(), 'utf8')).toMatch(/some-other-plugin/)
  })

  it('fresh install creates the @ran-sh scope directory itself', () => {
    expect(existsSync(join(home, 'profiles', 'node_modules', '@ran-sh'))).toBe(false)
    run(installScript)
    expect(existsSync(join(home, 'profiles', 'node_modules', '@ran-sh', 'dsh-vision'))).toBe(true)
  })

  it('--dry-run performs zero mutations', () => {
    const before = readFileSync(patchPath(), 'utf8')
    const out = run(installScript, ['--dry-run'])
    expect(out).toMatch(/\[dry-run\]/)
    expect(readFileSync(patchPath(), 'utf8')).toBe(before)
    expect(existsSync(visionLink())).toBe(false)
    const webDir = require('node:fs').readdirSync(join(home, 'profiles', 'web'))
    expect(webDir.filter(f => f.includes('.bak-'))).toHaveLength(0)
  })

  it('preserves CRLF in the patch file', () => {
    const crlf = '\r\n'
    writeFileSync(patchPath(), '# existing patch' + crlf + '- insert:' + crlf + '    - id: some-other-plugin' + crlf + '      name: dsh-some-other' + crlf)
    run(installScript)
    const text = readFileSync(patchPath(), 'utf8')
    expect(text).toContain(crlf)
    expect(text).toMatch(/- id: vision-runtime/)
    const lfOnly = text.split('\n').filter(line => line.length > 0 && !line.endsWith('\r')).length
    expect(lfOnly).toBe(0)
  })

  it('refuses to guess when multiple profiles exist and none is named', () => {
    rmSync(join(home, 'profiles', 'web'), { recursive: true, force: true })
    for (const name of ['alpha', 'beta']) {
      mkdirSync(join(home, 'profiles', name), { recursive: true })
      writeFileSync(join(home, 'profiles', name, 'cordis.patch.yml'), '# ' + name + '\n')
    }
    expect(() => run(installScript)).toThrow(/multiple profiles|refusing to guess/)
  })

  it('--profile names the target explicitly', () => {
    mkdirSync(join(home, 'profiles', 'other'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'other', 'cordis.patch.yml'), '# other\n')
    const out = run(installScript, ['--profile', 'other'])
    expect(out).toMatch(/added dsh-vision rows/)
    expect(readFileSync(join(home, 'profiles', 'other', 'cordis.patch.yml'), 'utf8')).toMatch(/- id: vision-runtime/)
    expect(readFileSync(patchPath(), 'utf8')).not.toMatch(/- id: vision-runtime/)
  })

  it('refuses to install when the build artifact is missing', () => {
    const lib = join(projectRoot, 'packages', 'vision', 'lib')
    const moved = lib + '.test-hidden'
    renameSync(lib, moved)
    try {
      expect(() => run(installScript)).toThrow(/no built artifact/)
    } finally {
      renameSync(moved, lib)
    }
  })

  it('uninstall cleans the empty @ran-sh scope directory', () => {
    run(installScript)
    run(uninstallScript)
    expect(existsSync(join(home, 'profiles', 'node_modules', '@ran-sh'))).toBe(false)
  })

  it('uninstall --dry-run performs zero mutations', () => {
    run(installScript)
    const before = readFileSync(patchPath(), 'utf8')
    const out = run(uninstallScript, ['--dry-run'])
    expect(out).toMatch(/\[dry-run\]/)
    expect(readFileSync(patchPath(), 'utf8')).toBe(before)
    expect(existsSync(visionLink())).toBe(true)
  })
})
