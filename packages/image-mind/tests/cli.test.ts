/**
 * Unit tests for the dsh-plugin-image-mind lifecycle CLI (`npm test` inside
 * the workspace package). Everything here is offline and side-effect free:
 * parsers, pure decision planners, redaction, the process-runner boundary
 * and resolver behavior against fixture directories. The heavyweight packed-
 * artifact roundtrip against an isolated exact rc.2 Harness lives in the
 * root tests/cli-packed-lifecycle.test.ts (gated).
 * @vitest-environment node
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterAll } from 'vitest'
import { COMPATIBILITY_TARGET, DEFAULT_PROFILE, PLUGIN_PACKAGE, SERVICE_PACKAGE, USAGE } from '../src/cli/constants.ts'
import { officialDumpConfigArgs, officialPluginArgs, officialVersionArgs, resolveDshEntry } from '../src/cli/dsh.ts'
import { parseArgv, UsageError } from '../src/cli/main.ts'
import {
  buildStatusReport,
  decideInstall,
  decideUpdate,
  sharedServiceReferencers,
} from '../src/cli/plan.ts'
import { isValidProfileName, readProfileState, resolveProfileDir } from '../src/cli/profile.ts'
import { redactError, redactText } from '../src/cli/redact.ts'
import { runProcess } from '../src/cli/runner.ts'
import { compareVersions, parseVersion, versionRelation } from '../src/cli/semver.ts'

function baseState(overrides: Partial<Parameters<typeof buildStatusReport>[0]> = {}) {
  return {
    profile: 'web',
    profileDir: join('home', 'profiles', 'web'),
    initialized: true,
    manifest: { dependencies: {} as Record<string, string>, bundles: [] as string[] },
    pluginSpec: null,
    plugin: { present: false, version: null },
    service: { present: false, version: null },
    serviceReferencedBy: [] as string[],
    ...overrides,
  }
}

describe('argument parsing', () => {
  it('defaults to the web profile without options', () => {
    expect(parseArgv(['status'])).toMatchObject({ command: 'status', profile: DEFAULT_PROFILE })
    expect(DEFAULT_PROFILE).toBe('web')
  })

  it('accepts options before and after the command', () => {
    const parsed = parseArgv(['--json', 'status', '--profile', 'tui'])
    expect(parsed.command).toBe('status')
    expect(parsed.json).toBe(true)
    expect(parsed.profile).toBe('tui')
  })

  it('parses advanced overrides as plain data', () => {
    const parsed = parseArgv(['install', '--from', './artifacts/pkg-0.2.0.tgz', '--dsh-bin', 'D:/bin/d.js'])
    expect(parsed.from).toBe('./artifacts/pkg-0.2.0.tgz')
    expect(parsed.dshBin).toBe('D:/bin/d.js')
  })

  it('flags help and version requests', () => {
    expect(parseArgv([])).toMatchObject({ help: false, version: false })
    expect(parseArgv(['--help']).help).toBe(true)
    expect(parseArgv(['-V']).version).toBe(true)
  })

  it('rejects unknown commands, extra arguments and unknown options with usage guidance', () => {
    expect(() => parseArgv(['repair'])).toThrow(UsageError)
    expect(() => parseArgv(['status', 'extra'])).toThrow(/unexpected extra argument/)
    expect(() => parseArgv(['install', '--force'])).toThrow(/unknown option --force/)
    try {
      parseArgv(['nope'])
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain('install | update | status | uninstall')
    }
  })

  it('requires values for value-taking options', () => {
    expect(() => parseArgv(['install', '--profile'])).toThrow(/--profile requires a value/)
    expect(() => parseArgv(['update', '--from'])).toThrow(/--from requires a value/)
    expect(() => parseArgv(['install', '--dsh-bin'])).toThrow(/--dsh-bin requires a value/)
  })
})

describe('profile name validation', () => {
  it('accepts ordinary names and rejects hostile shapes before any spawn', () => {
    expect(isValidProfileName('web')).toBe(true)
    expect(isValidProfileName('cli-e2e_01')).toBe(true)
    expect(isValidProfileName('.')).toBe(false)
    expect(isValidProfileName('..')).toBe(false)
    expect(isValidProfileName('node_modules')).toBe(false)
    expect(isValidProfileName('a/b')).toBe(false)
    expect(isValidProfileName('a\\b')).toBe(false)
    expect(isValidProfileName('a b;c|rm&d')).toBe(false)
    expect(isValidProfileName('-leading-dash')).toBe(false)
    expect(isValidProfileName('')).toBe(false)
  })

  it('resolves profile directories under DSH_HOME like the official launcher', () => {
    const dir = resolveProfileDir('web', { DSH_HOME: '/tmp/h' })
    expect(dir.replaceAll('\\', '/')).toBe('/tmp/h/profiles/web')
    expect(resolveProfileDir('web', {}).includes(join('.dsh', 'profiles'))).toBe(true)
  })
})

describe('semver comparison and relations', () => {
  it('orders core versions and prereleases like npm', () => {
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('0.1.1-rc.1', '0.1.1-rc.2')).toBe(-1)
    expect(compareVersions('0.1.1-rc.2', '0.1.1')).toBe(-1)
    expect(parseVersion('garbage')).toBeNull()
  })

  it('reports absent or unparsable installs as unknown instead of guessing', () => {
    expect(versionRelation(null, '0.2.0')).toBe('unknown')
    expect(versionRelation('', '0.2.0')).toBe('unknown')
    expect(versionRelation('0.2.0', '0.2.0')).toBe('same')
    expect(versionRelation('0.1.9', '0.2.0')).toBe('older')
    expect(versionRelation('0.3.0', '0.2.0')).toBe('newer')
  })
})

describe('redaction', () => {
  it('masks key-shaped material, bearer tokens and assignments', () => {
    const out = redactText('key sk-abcdef1234567890 done')
    expect(out).toContain('sk-***')
    expect(out).not.toContain('abcdef1234567890')
    expect(redactText('http://x?api_key=supersecretvalue')).not.toContain('supersecretvalue')
    const bearer = redactText('Authorization: Bearer abc.def.ghi')
    expect(bearer).not.toContain('abc.def.ghi')
    expect(bearer).toContain('***')
    expect(redactText('http://x?api_key=supersecretvalue')).not.toContain('supersecretvalue')
    expect(redactText('token="hunter2"')).not.toContain('hunter2')
  })

  it('hides the home directory prefix from paths', () => {
    const home = process.env.USERPROFILE ?? ''
    if (home.length > 1) {
      const redacted = redactText(join(home, 'secret.txt'))
      expect(redacted).not.toContain(home)
      expect(redacted).toContain('~')
    }
  })

  it('redacts thrown errors of any shape', () => {
    expect(redactError(new Error('boom sk-live-abcdefghijklmnop'))).toContain('sk-***')
    expect(redactError(42)).toBe('42')
  })
})

describe('process runner boundary', () => {
  it('passes arguments strictly as data and reports real exit codes', async () => {
    // Arguments containing shell metacharacters MUST arrive verbatim; the
    // child echoes its full argv back proving nothing was interpreted by a
    // shell and nothing was lost or merged.
    const script = 'process.stdout.write(JSON.stringify(process.argv))'
    const hostile = ['a;b|rm&c', '"quoted"', '$HOME', '--profile=x\ny']
    const run = await runProcess(process.execPath, ['-e', script, ...hostile])
    expect(run.ok).toBe(true)
    const argv = JSON.parse(run.stdout) as string[]
    for (const arg of hostile) expect(argv, `argv must contain ${JSON.stringify(arg)}`).toContain(arg)
  })

  it('propagates nonzero exits with captured streams', async () => {
    const run = await runProcess(process.execPath, ['-e', 'console.error("oops"); process.exit(3)'])
    expect(run.ok).toBe(false)
    expect(run.exitCode).toBe(3)
    expect(run.stderr).toContain('oops')
  })

  it('reports spawn failures as redacted errors instead of throwing', async () => {
    const run = await runProcess('definitely-not-a-real-binary-xyz', ['arg'])
    expect(run.ok).toBe(false)
    expect(run.exitCode).toBeNull()
    expect(run.error).toBeDefined()
  })

  it('kills children that exceed the timeout', async () => {
    const run = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 300,
    })
    expect(run.ok).toBe(false)
    expect(run.error).toBeDefined()
  }, 15_000)
})

describe('official command mapping', () => {
  it('builds the documented dsh plugin forwarder argv', () => {
    expect(officialPluginArgs('web', ['add', 'pkg@1.0.0'])).toEqual([
      'plugin',
      '--profile',
      'web',
      'add',
      'pkg@1.0.0',
    ])
    expect(officialVersionArgs()).toEqual(['--version'])
    expect(officialDumpConfigArgs('tui')).toEqual(['--profile', 'tui', '--dump-config'])
  })
})

describe('install planning', () => {
  it('is a no-op when the exact running version is already active', () => {
    const decision = decideInstall(
      baseState({
        plugin: { present: true, version: '0.2.0' },
        manifest: { dependencies: { [PLUGIN_PACKAGE]: '0.2.0' }, bundles: [PLUGIN_PACKAGE] },
      }),
      `${PLUGIN_PACKAGE}@0.2.0`,
    )
    expect(decision.mode).toBe('noop')
    expect(decision.reason).toContain('already installed and active')
  })

  it('re-runs the official add when the layer went missing despite the dependency', () => {
    const decision = decideInstall(
      baseState({ plugin: { present: true, version: '0.2.0' } }),
      `${PLUGIN_PACKAGE}@0.2.0`,
    )
    expect(decision.mode).toBe('official')
    expect(decision.verb).toBe('add')
  })

  it('forwards arbitrary specs (tarballs, ranges) to the official installer', () => {
    const decision = decideInstall(baseState(), './packed/pkg.tgz')
    expect(decision.mode).toBe('official')
    expect(decision.spec).toBe('./packed/pkg.tgz')
  })

  it('installs a fresh profile officially', () => {
    const decision = decideInstall(baseState(), `${PLUGIN_PACKAGE}@0.2.0`)
    expect(decision.mode).toBe('official')
    expect(decision.spec).toBe(`${PLUGIN_PACKAGE}@0.2.0`)
  })
})

describe('update planning', () => {
  it('errors with install guidance when the plugin is absent', () => {
    const decision = decideUpdate(baseState(), '0.2.0')
    expect(decision.mode).toBe('error')
    expect(decision.reason).toContain('run install first')
  })

  it('is a safe no-op for same-version installs', () => {
    const decision = decideUpdate(baseState({ plugin: { present: true, version: '0.2.0' } }), '0.2.0')
    expect(decision.mode).toBe('noop')
    expect(decision.reason).toContain('matches the CLI version')
  })

  it('converges older installs through the official add', () => {
    const decision = decideUpdate(baseState({ plugin: { present: true, version: '0.1.0' } }), '0.2.0')
    expect(decision.mode).toBe('official')
    expect(decision.verb).toBe('add')
    expect(decision.spec).toBe(`${PLUGIN_PACKAGE}@0.2.0`)
    expect(decision.reason).toContain('older')
  })

  it('also converges newer-than-CLI installs back to the running version', () => {
    const decision = decideUpdate(baseState({ plugin: { present: true, version: '0.3.0' } }), '0.2.0')
    expect(decision.mode).toBe('official')
    expect(decision.reason).toContain('newer')
  })
})

describe('uninstall retention evidence', () => {
  it('lists other layers that reference the shared service', () => {
    // Order follows the profile manifest scan (already sorted upstream).
    const referencers = sharedServiceReferencers(
      baseState({ serviceReferencedBy: ['dsh-plugin-image-mind', 'other-plugin', 'another-one'] }),
    )
    expect(referencers).toEqual(['other-plugin', 'another-one'])
  })

  it('keeps the list empty when nothing else references the service', () => {
    expect(sharedServiceReferencers(baseState())).toEqual([])
  })
})

describe('status reporting', () => {
  it('produces a stable JSON shape for an installed profile', () => {
    const report = buildStatusReport(
      baseState({
        plugin: { present: true, version: '0.2.0' },
        pluginSpec: '^0.2.0',
        manifest: {
          dependencies: { [PLUGIN_PACKAGE]: '^0.2.0' },
          bundles: [PLUGIN_PACKAGE],
        },
        service: { present: true, version: '0.2.0' },
      }),
      '0.2.0',
      '0.1.1-rc.2',
      `exact @deepseek-ai/dsh@${COMPATIBILITY_TARGET} line`,
    )
    expect(Object.keys(report)).toEqual([
      'ok',
      'command',
      'profile',
      'profileDir',
      'cliVersion',
      'harness',
      'plugin',
      'service',
    ])
    expect(report.harness).toEqual({ target: `exact @deepseek-ai/dsh@${COMPATIBILITY_TARGET} line`, detected: '0.1.1-rc.2' })
    expect(report.plugin.relation).toBe('same')
    expect(report.service.referencedByOtherLayers).toEqual([])
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({ ok: true, command: 'status' })
  })

  it('describes a missing plugin as absent without exceptions', () => {
    const report = buildStatusReport(baseState({ initialized: false, manifest: null }), '0.2.0', null, 'target')
    expect(report.profileDir).toBeNull()
    expect(report.plugin.installed).toBe(false)
    expect(report.plugin.relation).toBe('absent')
    expect(report.harness.detected).toBeNull()
  })
})

describe('read-only profile inspection', () => {
  const home = mkdtempSync(join(tmpdir(), 'im-cli-unit-'))

  it('reads manifest, versions and service references without writing anything', () => {
    const profileDir = resolveProfileDir('fixture', { DSH_HOME: home })
    mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-image-mind'), { recursive: true })
    mkdirSync(join(profileDir, 'node_modules', '@ran-sh', 'dsh-vision'), { recursive: true })
    mkdirSync(join(profileDir, 'node_modules', 'sibling-bundle'), { recursive: true })
    writeFileSync(
      join(profileDir, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: {
          'dsh-plugin-image-mind': 'file:pkgs/image-mind.tgz',
          'sibling-bundle': '1.0.0',
          '@ran-sh/dsh-vision': 'file:pkgs/vision.tgz',
        },
        dsh: { profile: { bundles: ['dsh-plugin-image-mind', 'sibling-bundle'] } },
      }),
    )
    writeFileSync(join(profileDir, 'node_modules', 'dsh-plugin-image-mind', 'package.json'), '{"version":"0.2.0"}')
    writeFileSync(join(profileDir, 'node_modules', '@ran-sh', 'dsh-vision', 'package.json'), '{"version":"0.2.0"}')
    writeFileSync(
      join(profileDir, 'node_modules', 'sibling-bundle', 'package.json'),
      JSON.stringify({ version: '1.0.0', dependencies: { [SERVICE_PACKAGE]: '^0.2.0' } }),
    )

    const state = readProfileState('fixture', { DSH_HOME: home })
    expect(state.initialized).toBe(true)
    expect(state.plugin).toEqual({ present: true, version: '0.2.0' })
    expect(state.manifest?.bundles).toEqual(['dsh-plugin-image-mind', 'sibling-bundle'])
    expect(state.service.present).toBe(true)
    expect(state.serviceReferencedBy).toEqual(['sibling-bundle'])
  })

  it('treats an uninitialized profile as cleanly absent', () => {
    const state = readProfileState('ghost', { DSH_HOME: home })
    expect(state.initialized).toBe(false)
    expect(state.manifest).toBeNull()
    expect(state.plugin.present).toBe(false)
    expect(state.service.present).toBe(false)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })
})

describe('official dsh entry resolution', () => {
  it('honors an explicit path and rejects missing ones', () => {
    expect(resolveDshEntry('./definitely/missing/bin.js')).toBeNull()
  })

  it('finds the repository devDependency installation without any config', () => {
    const entry = resolveDshEntry()
    expect(entry).not.toBeNull()
    expect(entry!.replaceAll('\\', '/')).toContain('@deepseek-ai/dsh/lib/bin.js')
  })

  it('documents the compatibility target and usage surface', () => {
    expect(COMPATIBILITY_TARGET).toBe('0.1.1-rc.2')
    expect(USAGE).toContain('install')
    expect(USAGE).toContain('update')
    expect(USAGE).toContain('status')
    expect(USAGE).toContain('uninstall')
    expect(USAGE).toContain('--profile <name>')
  })
})
