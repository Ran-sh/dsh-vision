/**
 * Release fail-safe regression (Batch 022) for the exact defective-0.2.0
 * incident: a package published without build output produced metadata-only
 * empty-shell tarballs. These tests exercise the REAL npm packaging
 * lifecycle (`npm pack`, which runs the `prepack` guard) against synthetic
 * fixture packages in task-owned temp directories, proving:
 *
 *   1. packing with missing outputs AUTO-BUILDS and ships working entries;
 *   2. changed inputs are detected by CONTENT hash and freshly rebuilt into
 *      the tarball (no silent stale output);
 *   3. an impossible/failing build FAILS CLOSED before any tarball is
 *      produced, with a clear error.
 *
 * The real workspace packages additionally prove the no-op fresh path via
 * tests/package.test.ts (which runs npm pack through the same lifecycle).
 * @vitest-environment node
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const IS_WIN = process.platform === 'win32'
const REPO_ROOT = resolve(import.meta.dirname, '..')

let room = ''
let seq = 0

function nextFixtureDir(): string {
  seq += 1
  const dir = join(room, `pkg-${seq}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `pack-guard-fixture-${seq}`,
      version: '1.0.0',
      type: 'module',
      files: ['dist/hello.js'],
      scripts: {
        build: 'node build.mjs',
        prepack: `node ${join(REPO_ROOT, 'scripts', 'pack-guard.mjs')}`,
      },
      packGuard: { entries: ['dist/hello.js'], inputs: ['src', 'build.mjs'] },
    }),
  )
  return dir
}

/** A tiny deterministic "build": dist/hello.js embeds src/input.txt content. */
const GOOD_BUILD_MJS = [
  "import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'",
  "mkdirSync('dist', { recursive: true })",
  "writeFileSync('dist/hello.js', 'export const hello = ' + JSON.stringify(readFileSync('src/input.txt', 'utf8')))",
].join('\n')

/** A build that always fails — used to prove the guard fails closed. */
const BROKEN_BUILD_MJS = "process.stderr.write('synthetic build explosion\\n'); process.exit(3)"

function makeFixture(buildMjs: string, inputContent: string): string {
  const dir = nextFixtureDir()
  writeFileSync(join(dir, 'build.mjs'), buildMjs)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'input.txt'), inputContent)
  return dir
}

interface PackResult {
  status: number | null
  files: string[]
  stderr: string
}

function realNpmPack(dir: string): PackResult {
  try {
    const out = execFileSync('npm', ['pack', '--json'], { cwd: dir, encoding: 'utf8', shell: IS_WIN })
    const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>
    return { status: 0, files: parsed.flatMap((entry) => entry.files.map((file) => file.path)), stderr: '' }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    let files: string[] = []
    try {
      const parsed = JSON.parse(err.stdout ?? 'null') as Array<{ files: Array<{ path: string }> }> | null
      if (Array.isArray(parsed)) files = parsed.flatMap((entry) => entry.files.map((file) => file.path))
    } catch {
      // non-JSON output on failure is expected
    }
    return { status: err.status ?? 1, files, stderr: err.stderr ?? String(error) }
  }
}

beforeAll(() => {
  room = mkdtempSync(join(tmpdir(), 'pack-guard-'))
})

afterAll(() => {
  rmSync(room, { recursive: true, force: true })
})

describe('prepack release fail-safe (real npm pack lifecycle)', () => {
  it('auto-builds missing outputs and ships a WORKING entry instead of an empty shell', () => {
    // The incident state: NO output directory at all.
    const dir = makeFixture(GOOD_BUILD_MJS, 'incident-proof')
    expect(existsSync(join(dir, 'dist'))).toBe(false)

    const result = realNpmPack(dir)
    expect(result.status, result.stderr).toBe(0)
    // Complete-for-this-fixture: manifest + REAL built artifact. The 0.2.0
    // incident shipped exactly this shape WITHOUT the built entry.
    expect(result.files.sort()).toEqual(['dist/hello.js', 'package.json'])
    expect(readFileSync(join(dir, 'dist', 'hello.js'), 'utf8')).toContain('incident-proof')
  })

  it('detects changed inputs by content hash and repacks fresh output', () => {
    const dir = makeFixture(GOOD_BUILD_MJS, 'version-a')
    expect(realNpmPack(dir).status).toBe(0)

    // Simulate a source edit WITHOUT rebuilding manually.
    writeFileSync(join(dir, 'src', 'input.txt'), 'version-b-stale-guard-would-miss-this')

    const result = realNpmPack(dir)
    expect(result.status, result.stderr).toBe(0)
    expect(result.files).toContain('dist/hello.js')
    expect(readFileSync(join(dir, 'dist', 'hello.js'), 'utf8')).toContain('version-b-stale-guard-would-miss-this')
  })

  it('fails closed with a clear error when the build cannot produce entries', () => {
    const dir = makeFixture(BROKEN_BUILD_MJS, 'never-built')
    const result = realNpmPack(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/pack-guard|build failed|refusing to package/)
    expect(result.stderr).not.toMatch(/npm notice.*\.tgz/) // no tarball was produced
    expect(result.files).not.toContain('dist/hello.js')
  })
})
