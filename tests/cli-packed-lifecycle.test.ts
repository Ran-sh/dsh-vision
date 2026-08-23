/**
 * Packed-artifact lifecycle acceptance for the dsh-plugin-image-mind CLI
 * (`RUN_CLI_LIFECYCLE=1 vitest run tests/cli-packed-lifecycle.test.ts`).
 *
 * Runs the REAL official @deepseek-ai/dsh@0.1.1-rc.2 plugin forwarder against
 * a disposable DSH_HOME: both workspace packages are actually packed, the
 * CLI is installed FROM THE PACKED TARBALL (npm prefix layout), and every
 * user-facing lifecycle command is invoked through genuine npx/npm-exec bin
 * resolution before its mutations flow through official
 * `dsh plugin --profile <name> add|remove` operations. A pnpm overrides seam
 * inside each TASK-OWNED profile redirects @ran-sh/dsh-vision resolution to
 * the local vision tarball because 0.2.0 is intentionally unpublished.
 *
 * Nothing here touches the user's real Harness: DSH_HOME always points into
 * a mkdtemp directory, and cleanup removes it wholesale.
 * @vitest-environment node
 */

import { spawnSync, execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resolveDshEntry } from '../packages/image-mind/src/cli/dsh.ts'

const RUN = process.env.RUN_CLI_LIFECYCLE === '1'
const BOOT_SMOKE = process.env.DSH_CLI_BOOT_SMOKE === '1'
const IS_WIN = process.platform === 'win32'

let homeRoot = ''
let dshHome = ''
let packsDir = ''
let cliPrefix = ''
let dshEntry = ''
let visionTgz = ''
let imageMindTgz = ''

function shellFor(cmd: string): boolean {
  return cmd === 'npm' || cmd === 'pnpm' ? IS_WIN : false
}

function runCapture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env === undefined ? process.env : { ...process.env, ...opts.env },
    encoding: 'utf8',
    shell: shellFor(cmd),
    windowsHide: true,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function packPackage(pkgDir: string): string {
  const out = execFileSync('npm', ['pack', '--pack-destination', packsDir], {
    cwd: pkgDir,
    encoding: 'utf8',
    shell: IS_WIN,
  })
  const filename = out.trim().split(/\r?\n/).at(-1)!
  return join(packsDir, filename)
}

function posix(path: string): string {
  return path.replaceAll('\\', '/')
}

interface CliRun {
  status: number | null
  stdout: string
  stderr: string
}

function resolveNpxCli(): string {
  // Windows' npx.cmd shim cannot be spawned with shell:false. Invoke the
  // exact npm-provided npx CLI entry with Node instead; this preserves genuine
  // npm bin resolution while keeping every argument a separate argv element.
  const candidate = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
  if (!existsSync(candidate)) throw new Error(`npm npx CLI entry not found: ${candidate}`)
  return candidate
}

function runNpxCli(args: string[]): CliRun {
  // The packed CLI cannot see the repository's devDependency dsh install
  // from its isolated prefix, so tests pin it explicitly via the documented
  // --dsh-bin data option. The `--` delimiter ensures all following options
  // belong to the package rather than npm/npx itself.
  const npxArgs = ['--no-install', '--', 'dsh-plugin-image-mind', ...args, '--dsh-bin', dshEntry]
  return IS_WIN
    ? runCapture(process.execPath, [resolveNpxCli(), ...npxArgs], {
        cwd: cliPrefix,
        env: { DSH_HOME: dshHome },
      })
    : runCapture('npx', npxArgs, {
        cwd: cliPrefix,
        env: { DSH_HOME: dshHome },
      })
}

function statusJson(profile: string): Record<string, unknown> {
  const run = runNpxCli(['status', '--json', '--profile', profile])
  expect(run.status, run.stderr).toBe(0)
  return JSON.parse(run.stdout) as Record<string, unknown>
}

/**
 * Initialize a task-owned profile through the OFFICIAL forwarder only.
 * `withService` additionally installs the local vision tarball as a plain
 * profile dependency; otherwise the overrides seam alone redirects future
 * resolutions so transitive installs pull the service from the artifact.
 */
function seedProfile(profile: string, { withService = true } = {}): void {
  const officialCall =
    withService === true
      ? ['plugin', '--profile', profile, 'add', visionTgz]
      : // A bare `pnpm list` initializes the profile without installing
        // anything (the forwarder initializes on first use).
        ['plugin', '--profile', profile, 'list']
  const init = runCapture(process.execPath, [dshEntry, ...officialCall], {
    env: { DSH_HOME: dshHome },
  })
  expect(init.status, init.stderr).toBe(0)
  // Task-owned overrides seam: future resolutions of the unpublished
  // service resolve to the local vision tarball. This file belongs to the
  // disposable fixture profile, never to a user harness.
  appendFileSync(
    join(dshHome, 'profiles', profile, 'pnpm-workspace.yaml'),
    `overrides:\n  "@ran-sh/dsh-vision": "${posix(visionTgz)}"\n`,
  )
}

function buildFixtureBundle(
  dirName: string,
  manifest: Record<string, unknown>,
  patchBody: string,
): string {
  const dir = join(homeRoot, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, 'patch.yml'), patchBody)
  return packPackage(dir)
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (IS_WIN) {
    if (child.pid !== undefined) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    }
    return
  }
  child.kill('SIGTERM')
  const deadline = Date.now() + 5000
  const poll = setInterval(() => {
    if (child.exitCode !== null || Date.now() > deadline) {
      clearInterval(poll)
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 200)
}

async function bootSmoke(): Promise<{ url: string }> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(
      process.execPath,
      [dshEntry, '--profile', 'web', '--no-open', '--port', '0'],
      { env: { ...process.env, DSH_HOME: dshHome }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    let output = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        killTree(child)
        rejectBoot(new Error(`boot smoke timed out. Output so far:\n${output}`))
      }
    }, 120_000)

    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const match = /https?:\/\/\S+/.exec(output)
      if (!match || settled) return
      settled = true
      clearTimeout(timer)
      const url = match[0].replace(/[/)]+$/, '')
      fetch(`${url}/`)
        .then(async (response) => {
          if (!response.ok) throw new Error(`GET ${url}/ -> ${response.status}`)
          killTree(child)
          resolveBoot({ url })
        })
        .catch((error: unknown) => {
          killTree(child)
          rejectBoot(error instanceof Error ? error : new Error(String(error)))
        })
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        rejectBoot(new Error(`booted process exited early (${code}). Output:\n${output}`))
      }
    })
  })
}

describe.skipIf(!RUN)('packed dsh-plugin-image-mind CLI lifecycle (isolated exact rc.2)', () => {
  beforeAll(() => {
    const pnpm = runCapture('pnpm', ['--version'])
    expect(pnpm.status, 'pnpm must be on PATH for the official plugin forwarder').toBe(0)

    homeRoot = mkdtempSync(join(tmpdir(), 'im-cli-lifecycle-'))
    dshHome = join(homeRoot, 'dsh-home')
    packsDir = join(homeRoot, 'packs')
    cliPrefix = join(homeRoot, 'cli-prefix')
    const repoRoot = join(import.meta.dirname, '..')
    dshEntry = resolveDshEntry()!
    expect(existsSync(dshEntry), 'official dsh entry resolves from devDependencies').toBe(true)

    mkdirSync(packsDir, { recursive: true })
    visionTgz = packPackage(join(repoRoot, 'packages', 'vision'))
    imageMindTgz = packPackage(join(repoRoot, 'packages', 'image-mind'))

    // Co-installing BOTH packed tarballs lets npm satisfy the plugin's
    // @ran-sh/dsh-vision@^0.2.0 dependency from the local vision artifact —
    // the public registry intentionally has no 0.2.0 yet.
    const install = runCapture('npm', ['install', '--prefix', cliPrefix, imageMindTgz, visionTgz])
    expect(install.status, install.stderr).toBe(0)
    // npx/npm-exec discoverability: the bin shim must exist next to the
    // installed package, exactly like a registry install would create.
    expect(existsSync(join(cliPrefix, 'node_modules', 'dsh-plugin-image-mind', 'lib', 'cli.js'))).toBe(true)
    expect(existsSync(join(cliPrefix, 'node_modules', '.bin', 'dsh-plugin-image-mind'))).toBe(true)
    expect(existsSync(join(cliPrefix, 'node_modules', '.bin', 'dsh-plugin-image-mind.cmd'))).toBe(IS_WIN)
  }, 900_000)

  it('packed artifact exposes the npm bin target', () => {
    const manifest = JSON.parse(
      readFileSync(join(cliPrefix, 'node_modules', 'dsh-plugin-image-mind', 'package.json'), 'utf8'),
    ) as { version: string; bin: Record<string, string> }
    expect(manifest.version).toBe('0.2.0')
    expect(manifest.bin['dsh-plugin-image-mind']).toBe('lib/cli.js')
  })

  it('runs through genuine npx semantics on this platform', () => {
    const result = runNpxCli(['--version'])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('0.2.0')
  })

  it('install -> status -> second install stays idempotent in the web profile', () => {
    seedProfile('web')

    const first = runNpxCli(['install', '--from', imageMindTgz])
    expect(first.status, first.stdout + first.stderr).toBe(0)

    const state = statusJson('web') as {
      plugin: { installed: boolean; version: string; relation: string; layerActive: boolean }
      service: { present: boolean; version: string }
    }
    expect(state.plugin.installed).toBe(true)
    expect(state.plugin.version).toBe('0.2.0')
    expect(state.plugin.relation).toBe('same')
    expect(state.plugin.layerActive).toBe(true)
    expect(state.service.present).toBe(true)
    expect(state.service.version).toBe('0.2.0')

    const second = runNpxCli(['install', '--from', imageMindTgz])
    expect(second.status, second.stdout + second.stderr).toBe(0)

    const manifestPath = join(dshHome, 'profiles', 'web', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(Object.keys(manifest.dependencies).filter((name) => name === 'dsh-plugin-image-mind')).toHaveLength(1)
    expect(manifest.dsh.profile.bundles.filter((name) => name === 'dsh-plugin-image-mind')).toHaveLength(1)
  }, 600_000)

  it('same-version update is a safe no-op success', () => {
    const run = runNpxCli(['update', '--profile', 'web'])
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toContain('already matches the CLI version')
  }, 300_000)

  it('composition smoke: dump-config composes the plugin layer without booting', () => {
    const run = runCapture(process.execPath, [dshEntry, '--profile', 'web', '--dump-config'], {
      env: { DSH_HOME: dshHome },
    })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('image-mind')
  }, 300_000)

  it.runIf(BOOT_SMOKE)('boot smoke: web reaches HTTP 200 on a task-owned port', async () => {
    const { url } = await bootSmoke()
    console.log(`boot smoke reached ${url}`)
  }, 180_000)

  it('uninstall removes the plugin but keeps a shared referenced service', () => {
    // No pre-installed service here: the consumer pulls @ran-sh/dsh-vision
    // transitively through the overrides seam, so the final cleanup can
    // prove official tooling prunes the service when its last referencer
    // disappears.
    seedProfile('shared', { withService: false })
    const consumerPatch = '- insert:\n    - id: fake-consumer-row\n'
    const consumerTgz = buildFixtureBundle(
      'fake-consumer',
      {
        name: 'fake-vision-consumer',
        version: '1.0.0',
        type: 'module',
        dependencies: { '@ran-sh/dsh-vision': '^0.2.0' },
        dsh: { bundle: { patch: './patch.yml' } },
      },
      consumerPatch,
    )
    const addConsumer = runCapture(process.execPath, [dshEntry, 'plugin', '--profile', 'shared', 'add', consumerTgz], {
      env: { DSH_HOME: dshHome },
    })
    expect(addConsumer.status, addConsumer.stderr).toBe(0)

    const install = runNpxCli(['install', '--from', imageMindTgz, '--profile', 'shared'])
    expect(install.status, install.stdout + install.stderr).toBe(0)

    const uninstall = runNpxCli(['uninstall', '--profile', 'shared'])
    expect(uninstall.status, uninstall.stdout + uninstall.stderr).toBe(0)
    expect(uninstall.stdout).toContain('fake-vision-consumer')
    expect(uninstall.stdout).toContain('kept in the profile')

    const after = statusJson('shared') as unknown as {
      plugin: { installed: boolean }
      service: { present: boolean }
    }
    expect(after.plugin.installed).toBe(false)
    expect(after.service.present).toBe(true)

    const manifest = JSON.parse(readFileSync(join(dshHome, 'profiles', 'shared', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dependencies['dsh-plugin-image-mind']).toBeUndefined()
    expect(manifest.dependencies['fake-vision-consumer']).toBeDefined()

    // Cleanup proves the official tooling owns final pruning: removing the
    // last referencer takes the service with it, no manual deletion needed.
    const removeConsumer = runCapture(
      process.execPath,
      [dshEntry, 'plugin', '--profile', 'shared', 'remove', 'fake-vision-consumer'],
      { env: { DSH_HOME: dshHome } },
    )
    expect(removeConsumer.status, removeConsumer.stderr).toBe(0)
    const cleaned = statusJson('shared')
    expect((cleaned.service as { present: boolean }).present).toBe(false)
  }, 600_000)

  it('older-installed version converges to the running CLI version', () => {
    seedProfile('upgrade')
    const oldPatch = '- insert:\n    - id: legacy-row\n'
    const oldTgz = buildFixtureBundle(
      'old-plugin',
      {
        name: 'dsh-plugin-image-mind',
        version: '0.1.0',
        type: 'module',
        dsh: { bundle: { patch: './patch.yml' } },
      },
      oldPatch,
    )
    const addOld = runCapture(process.execPath, [dshEntry, 'plugin', '--profile', 'upgrade', 'add', oldTgz], {
      env: { DSH_HOME: dshHome },
    })
    expect(addOld.status, addOld.stderr).toBe(0)

    const before = statusJson('upgrade') as { plugin: { version: string; relation: string } }
    expect(before.plugin.version).toBe('0.1.0')
    expect(before.plugin.relation).toBe('older')

    const update = runNpxCli(['update', '--profile', 'upgrade', '--from', imageMindTgz])
    expect(update.status, update.stdout + update.stderr).toBe(0)

    const after = statusJson('upgrade') as { plugin: { version: string; relation: string; layerActive: boolean } }
    expect(after.plugin.version).toBe('0.2.0')
    expect(after.plugin.relation).toBe('same')
    expect(after.plugin.layerActive).toBe(true)
  }, 600_000)

  it('uninstall is idempotent when already absent and leaves clean layers', () => {
    const first = runNpxCli(['uninstall', '--profile', 'web'])
    expect(first.status, first.stdout + first.stderr).toBe(0)

    const gone = statusJson('web') as { plugin: { installed: boolean; relation: string } }
    expect(gone.plugin.installed).toBe(false)
    expect(gone.plugin.relation).toBe('absent')

    const second = runNpxCli(['uninstall', '--profile', 'web'])
    expect(second.status, second.stdout + second.stderr).toBe(0)
    expect(second.stdout).toContain('already absent')
  }, 600_000)

  afterEach(() => {
    // no-op hook reserved for per-test diagnostics if needed
  })

  afterAll(() => {
    rmSync(homeRoot, { recursive: true, force: true })
  }, 120_000)
})
