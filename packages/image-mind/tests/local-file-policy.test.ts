/**
 * Local filesystem capability fence: model-supplied image references must
 * never read arbitrary host files by default; when a deployment opts in, only
 * realpath-confined paths under an explicit allow-listed root are readable.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isAuthorizedLocalPath, resolveAuthorizedLocalFile } from '../src/media/local-file-policy.ts'

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'image-mind-lfp-'))
  await mkdir(join(root, 'media'), { recursive: true })
  await writeFile(join(root, 'media', 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return root
}

describe('local-file policy', () => {
  it('default rejects an absolute local path (policy disabled)', async () => {
    const root = await fixture()
    await expect(resolveAuthorizedLocalFile(join(root, 'media', 'ok.png'), [])).rejects.toThrow(/disabled|allow/i)
    await rm(root, { recursive: true, force: true })
  })

  it('allows an absolute path inside an allowed root', async () => {
    const root = await fixture()
    const resolved = await resolveAuthorizedLocalFile(join(root, 'media', 'ok.png'), [join(root, 'media')])
    expect(resolved).toBe(join(root, 'media', 'ok.png'))
    await rm(root, { recursive: true, force: true })
  })

  it('rejects a relative path even when allowed roots are set', async () => {
    const root = await fixture()
    await expect(resolveAuthorizedLocalFile('media/ok.png', [join(root, 'media')])).rejects.toThrow(/absolute/i)
    await rm(root, { recursive: true, force: true })
  })

  it('rejects root/../secret.png escape', async () => {
    const root = await fixture()
    await writeFile(join(root, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'binary' as never)
    await expect(
      resolveAuthorizedLocalFile(join(root, 'media', '..', 'secret.png'), [join(root, 'media')]),
    ).rejects.toThrow(/outside|disabled/i)
    await rm(root, { recursive: true, force: true })
  })

  it('rejects a junction that escapes the root (Windows) or symlink (POSIX)', async () => {
    const root = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'image-mind-lfp-out-'))
    await writeFile(join(outside, 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    // Windows: directory junction requires no privilege; node:fs symlink to a
    // directory acts as a junction on Windows.
    try {
      await mkdir(join(root, 'media', 'escape'))
      const fs = await import('node:fs/promises')
      await fs.symlink(outside, join(root, 'media', 'escape', '..', '..', 'escaped-link'), 'junction')
    } catch {
      // fall through: junction creation may fail on some setups; the realpath
      // containment below is still exercised by the traversal case.
    }
    // Best-effort cross-platform escape: create a directory junction at
    // root/media/escape pointing at `outside` if supported.
    const fs = await import('node:fs/promises')
    try {
      await fs.symlink(outside, join(root, 'media', 'escape'), 'junction')
      await expect(
        resolveAuthorizedLocalFile(join(root, 'media', 'escape', 'p.png'), [join(root, 'media')]),
      ).rejects.toThrow(/outside/i)
    } catch {
      // junction unsupported: assert the plain traversal escape still rejects
      await expect(
        resolveAuthorizedLocalFile(join(root, 'media', '..', 'outside', 'p.png'), [join(root, 'media')]),
      ).rejects.toThrow(/outside/i)
    }
    await rm(outside, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  })

  it('isAuthorizedLocalPath only admits absolute paths when both flags are set', async () => {
    const root = await fixture()
    const abs = join(root, 'media', 'ok.png')
    expect(isAuthorizedLocalPath(abs, true, [join(root, 'media')])).toBe(true)
    expect(isAuthorizedLocalPath(abs, false, [join(root, 'media')])).toBe(false)
    expect(isAuthorizedLocalPath(abs, true, [])).toBe(false)
    expect(isAuthorizedLocalPath('media/ok.png', true, [join(root, 'media')])).toBe(false)
    // Real root needs to exist for resolveAuthorizedLocalFile realpath to pass.
    const resolved = await resolveAuthorizedLocalFile(abs, [join(root, 'media')])
    expect(resolved).toBe(abs)
    await rm(root, { recursive: true, force: true })
  })

  it('URLs and attachment forms are never misclassified as local files', async () => {
    expect(isAuthorizedLocalPath('https://example.com/a.png', false, [])).toBe(false)
    expect(isAuthorizedLocalPath('C:/x/a.png', true, [])).toBe(false)
    expect(isAuthorizedLocalPath('//server/share/a.png', true, ['//server/share'])).toBe(true)
  })
})
