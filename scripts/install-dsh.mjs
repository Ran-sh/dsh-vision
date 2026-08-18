/**
 * `npm run install:dsh` — mount dsh-vision into a DeepSeek Harness profile.
 *
 * What it does (idempotent, safe, reversible):
 *   1. Resolves DSH_HOME (env override; else `~/.dsh`).
 *   2. Ensures the built artifacts exist (lib/index.js in both packages);
 *      a missing build fails loudly with the exact command to run (the
 *      installer never runs npm inside the DSH profile).
 *   3. Links the two packages into `<DSH_HOME>/profiles/node_modules`,
 *      creating the `@ran-sh` parent directory itself (junction on Windows,
 *      symlink elsewhere). Existing links are re-pointed at the CURRENT
 *      project path; real directories are left alone.
 *   4. Inserts the two profile rows into the chosen profile's
 *      cordis.patch.yml — with an ATOMIC write (temp file + rename) that
 *      preserves the file's existing newline style (CRLF stays CRLF), and a
 *      backup only when a mutation actually happens.
 *
 * YAML safety: the profile template ships a top-level `[]` (empty array).
 * A YAML document cannot mix a flow-style `[]` with block-style `- insert:`
 * entries, so the installer REMOVES a bare top-level `[]` (and its comment
 * lines) before appending the `- insert:` rows — the result is a pure
 * top-level block array that the loader parses.
 *
 * Profile selection: `--profile` wins; else `web`; else the single
 * candidate; MULTIPLE candidates without `--profile` are refused with the
 * list — the installer never silently modifies the wrong profile.
 *
 * `--dry-run` prints the exact plan with zero mutations.
 *
 * It NEVER touches: settings.yaml, the credential store, other plugins, or
 * anything beyond the two links and the two patch rows it owns. No npm
 * install/prune ever runs inside the profile.
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  lstatSync, unlinkSync, renameSync, copyFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

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

/** Pick the profile to patch: named > web > single candidate; ambiguity refused. */
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
  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0) {
    console.error(`no profile with cordis.patch.yml found under ${profilesRoot}`)
    process.exit(1)
  }
  // Multiple candidates and no explicit choice: never silently modify the
  // wrong profile — list them and require --profile.
  console.error(`multiple profiles found under ${profilesRoot}: ${candidates.join(', ')}`)
  console.error('refusing to guess; re-run with --profile <name>')
  process.exit(1)
}

/** Ensure the built artifacts exist; the installer never builds inside DSH. */
function checkBuilds() {
  for (const { name, target } of LINKS) {
    const built = join(target, 'lib', 'index.js')
    if (!existsSync(built)) {
      console.error(`${name} has no built artifact at ${built}`)
      console.error('run `npm install && npm run build` in the project first (the installer never runs npm inside DSH)')
      process.exit(1)
    }
  }
}

/** Whether the file uses CRLF line endings. */
function usesCrlf(text) {
  return text.includes('\r\n')
}

/** Atomic write: temp file + rename, preserving newline style. */
function atomicWrite(path, text, newline) {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, newline === 'crlf' ? text.replace(/\n/g, '\r\n') : text)
  renameSync(tmp, path)
}

/** Create a junction (Windows, no admin needed) or a symlink (POSIX). */
function linkPackage(name, target) {
  const linkPath = join(modulesRoot, name)
  // The scoped parent (`@ran-sh`) may not exist on a fresh profile; the
  // installer creates it — never relies on the test fixture having done so.
  mkdirSync(dirname(linkPath), { recursive: true })
  if (dryRun) {
    console.log(`[dry-run] would link ${name} -> ${target}`)
    return
  }
  try {
    const st = lstatSync(linkPath)
    if (st.isSymbolicLink()) {
      unlinkSync(linkPath)
    } else if (st.isDirectory()) {
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether the patch file already carries the two rows (idempotence check). */
function rowsPresent(patchText) {
  return ROWS.every(row => new RegExp(`-\\s*id:\\s*${row.id}[\\s\\S]{0,80}?name:\\s*['"]?${escapeRegExp(row.name)}`).test(patchText))
}

/**
 * Remove a bare top-level `[]` (and any comment lines directly above it) so
 * the resulting document is ONE block-style top-level array. YAML cannot mix
 * a flow-style `[]` with block-style `- insert:` entries in the same
 * document — this was the startup-breaking bug.
 */
function stripEmptyArray(text) {
  const lines = text.split('\n')
  const kept = []
  let removed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*\[\]\s*$/.test(line)) {
      // Drop the bare empty array line AND any comment lines that sit
      // directly above it (the template's own header comments).
      while (kept.length > 0 && /^\s*#/.test(kept[kept.length - 1])) kept.pop()
      removed = true
      continue
    }
    kept.push(line)
  }
  return { text: kept.join('\n'), removed }
}

/** Insert the two rows atomically, preserving newline style and backing up only on mutation. */
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
  const newline = usesCrlf(text) ? 'crlf' : 'lf'
  // Remove a template `[]` so the document stays a single block array.
  const stripped = stripEmptyArray(text)
  text = stripped.text
  const trimmed = text.trimEnd()
  const block = ROWS.map(row => `    - id: ${row.id}\n      name: ${JSON.stringify(row.name)}`).join('\n')
  const next = trimmed.length === 0
    ? `# dsh-vision plugin rows (installed by \`npm run install:dsh\`)\n- insert:\n${block}\n`
    : `${trimmed}\n\n# dsh-vision plugin rows (installed by \`npm run install:dsh\`)\n- insert:\n${block}\n`
  if (dryRun) {
    console.log(`[dry-run] would add dsh-vision rows to ${patchPath} (${newline}${stripped.removed ? ', removing bare []' : ''})`)
    return
  }
  // Backup only when a mutation is about to happen; then write atomically.
  const backup = `${patchPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  copyFileSync(patchPath, backup)
  console.log(`backed up ${patchPath} -> ${basename(backup)}`)
  atomicWrite(patchPath, next, newline)
  console.log(`added dsh-vision rows to ${patchPath} (${newline}${stripped.removed ? ', removed bare []' : ''})`)
}

console.log(`DSH_HOME: ${dshHome}${dryRun ? ' [dry-run]' : ''}`)
if (!existsSync(profilesRoot)) {
  console.error(`no Harness profiles found under ${profilesRoot}; is DeepSeek Harness installed? (set DSH_HOME to override)`)
  process.exit(1)
}

checkBuilds()

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
