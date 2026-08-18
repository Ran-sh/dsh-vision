/**
 * `npm run install:dsh` — mount dsh-vision into a DeepSeek Harness profile.
 *
 * What it does (idempotent, safe, reversible):
 *   1. Resolves DSH_HOME (env override; else `~/.dsh`).
 *   2. Links the two packages into `<DSH_HOME>/profiles/node_modules`:
 *        @ran-sh/dsh-vision        -> packages/vision
 *        dsh-plugin-image-mind     -> packages/image-mind
 *      A junction on Windows (works without admin rights), a symlink
 *      elsewhere. Existing links are replaced; the link target is ALWAYS the
 *      current project path, so moving the project needs a re-run.
 *   3. Inserts the two profile rows (`vision-runtime` + `image-mind`) into
 *      `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` — or the first
 *      profile found when none is named — without duplicating rows.
 *   4. Backs up any modified patch file to `<file>.bak-<timestamp>`.
 *
 * It NEVER touches: the user's settings.yaml (provider/key configuration),
 * the credential store, other plugins, or `<DSH_HOME>/profiles/node_modules`
 * beyond the two links it owns.
 *
 * Safety: no npm install / prune runs here, and the two links point at this
 * project's own packages — `npm install` in the workspace never follows them
 * (the SDK is now a registry dependency, not a junction).
 *
 * Usage:
 *   npm run install:dsh                # profile auto-detected (web first)
 *   npm run install:dsh -- --profile web
 *   DSH_HOME=... npm run install:dsh
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, unlinkSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0
  ? process.env.DSH_HOME
  : join(process.env.USERPROFILE ?? homedir(), '.dsh')

const profilesRoot = join(dshHome, 'profiles')
const modulesRoot = join(profilesRoot, 'node_modules')

/** The two packages this project mounts (project path -> package dir). */
const LINKS = [
  { name: '@ran-sh/dsh-vision', target: join(root, 'packages', 'vision') },
  { name: 'dsh-plugin-image-mind', target: join(root, 'packages', 'image-mind') },
]

/** The two rows the profile roster needs (Service + Provider). */
const ROWS = [
  { id: 'vision-runtime', name: '@ran-sh/dsh-vision' },
  { id: 'image-mind', name: 'dsh-plugin-image-mind' },
]

/** Parse the CLI: `--profile <name>`. */
function profileArg() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--profile')
  if (at >= 0 && args[at + 1] !== undefined) return args[at + 1]
  return undefined
}

/** Pick the profile to patch: the named one, else `web` if present, else the first. */
function pickProfile() {
  const named = profileArg()
  if (named !== undefined) {
    const dir = join(profilesRoot, named)
    if (!existsSync(dir)) {
      console.error(`profile "${named}" not found under ${profilesRoot}`)
      process.exit(1)
    }
    return named
  }
  const candidates = readdirSync(profilesRoot).filter(entry => {
    try {
      return lstatSync(join(profilesRoot, entry)).isDirectory() && existsSync(join(profilesRoot, entry, 'cordis.patch.yml'))
    } catch {
      return false
    }
  }).sort()
  if (candidates.includes('web')) return 'web'
  if (candidates.length === 0) {
    console.error(`no profile with cordis.patch.yml found under ${profilesRoot}`)
    process.exit(1)
  }
  return candidates[0]
}

/** Create a junction (Windows, no admin needed) or a symlink (POSIX). */
function linkPackage(name, target) {
  const linkPath = join(modulesRoot, name)
  mkdirSync(modulesRoot, { recursive: true })
  try {
    const st = lstatSync(linkPath)
    if (st.isSymbolicLink()) {
      // Re-point an existing link to the current project path.
      unlinkSync(linkPath)
    } else if (st.isDirectory()) {
      // A real directory would be a user's own package; leave it alone.
      console.log(`skip ${name}: ${linkPath} exists as a real directory (not ours)`)
      return
    }
  } catch {
    // Not present: fine.
  }
  const targetWin = target.replaceAll('/', '\\')
  const linkWin = linkPath.replaceAll('/', '\\')
  const result = process.platform === 'win32'
    ? spawnSync('cmd', ['/c', 'mklink', '/J', linkWin, targetWin], { stdio: 'pipe', encoding: 'utf8' })
    : spawnSync('ln', ['-s', target, linkPath], { stdio: 'pipe', encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(`failed to link ${name} -> ${target}: ${String(result.stderr ?? result.stdout).trim()}`)
    process.exit(1)
  }
  console.log(`linked ${name} -> ${target}`)
}

/** Whether the patch file already carries the two rows (idempotence check). */
function rowsPresent(patchText) {
  return ROWS.every(row => new RegExp(`-\\s*id:\\s*${row.id}[\\s\\S]{0,80}?name:\\s*['"]?${escapeRegExp(row.name)}`).test(patchText))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Insert the two rows into the patch file (backing it up first). */
function patchProfile(profile) {
  const patchPath = join(profilesRoot, profile, 'cordis.patch.yml')
  let text = ''
  try {
    text = readFileSync(patchPath, 'utf8')
  } catch {
    text = ''
  }
  if (rowsPresent(text)) {
    console.log(`patch already present in ${patchPath}; nothing to add`)
    return
  }
  // Backup the current content before touching it.
  const backup = `${patchPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  renameSync(patchPath, backup)
  console.log(`backed up ${patchPath} -> ${basename(backup)}`)
  const trimmed = text.trimEnd()
  const block = ROWS.map(row => `    - id: ${row.id}\n      name: ${JSON.stringify(row.name)}`).join('\n')
  const next = trimmed.length === 0
    ? `# dsh-vision plugin rows (installed by \`npm run install:dsh\`)\n- insert:\n${block}\n`
    : `${trimmed}\n\n# dsh-vision plugin rows (installed by \`npm run install:dsh\`)\n- insert:\n${block}\n`
  writeFileSync(patchPath, next)
  console.log(`added dsh-vision rows to ${patchPath}`)
}

console.log(`DSH_HOME: ${dshHome}`)
if (!existsSync(profilesRoot)) {
  console.error(`no Harness profiles found under ${profilesRoot}; is DeepSeek Harness installed? (set DSH_HOME to override)`)
  process.exit(1)
}

for (const { name, target } of LINKS) {
  if (!existsSync(join(target, 'package.json'))) {
    console.error(`package ${name} not found at ${target}; run from the project root`)
    process.exit(1)
  }
  linkPackage(name, target)
}

const profile = pickProfile()
patchProfile(profile)
console.log(`\ndone. Restart the web profile (or trigger its HMR reload) to activate:\n  1. 设置 → 插件 → 图像理解\n  2. 添加提供方 / 填入 API Key\n  3. 测试连接\nTo remove: npm run uninstall:dsh`)
