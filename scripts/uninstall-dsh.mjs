/**
 * `npm run uninstall:dsh` — unmount dsh-vision from a DeepSeek Harness profile.
 *
 * Removes exactly what `install:dsh` created:
 *   1. The two links under `<DSH_HOME>/profiles/node_modules` (only if they
 *      still point at THIS project; a repurposed directory is left alone).
 *   2. The two profile rows from the cordis patch (matching the installed
 *      block text; everything else in the file is preserved).
 *   3. With `--purge-settings`, also removes the `image-mind` section from
 *      `<DSH_HOME>/settings.yaml` (provider/key configuration) — OFF by
 *      default, because uninstalling the plugin must not delete the user's
 *      configuration.
 *
 * It NEVER touches: other plugins, other patch rows, the credential store,
 * or `profiles/node_modules` beyond the two links it owns.
 *
 * Usage:
 *   npm run uninstall:dsh
 *   npm run uninstall:dsh -- --purge-settings
 *   npm run uninstall:dsh -- --profile web
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, lstatSync, unlinkSync, renameSync, realpathSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0
  ? process.env.DSH_HOME
  : join(process.env.USERPROFILE ?? homedir(), '.dsh')

const profilesRoot = join(dshHome, 'profiles')
const modulesRoot = join(profilesRoot, 'node_modules')

const LINK_NAMES = ['@ran-sh/dsh-vision', 'dsh-plugin-image-mind']

const ROW_IDS = ['vision-runtime', 'image-mind']
const ROW_NAMES = ['@ran-sh/dsh-vision', 'dsh-plugin-image-mind']

const purgeSettings = process.argv.includes('--purge-settings')
const dryRun = process.argv.includes('--dry-run')

function profileArg() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--profile')
  if (at >= 0 && args[at + 1] !== undefined) return args[at + 1]
  return undefined
}

function pickProfile() {
  const named = profileArg()
  if (named !== undefined) return existsSync(join(profilesRoot, named)) ? named : undefined
  const candidates = readdirSync(profilesRoot).filter(entry => {
    try {
      return lstatSync(join(profilesRoot, entry)).isDirectory() && existsSync(join(profilesRoot, entry, 'cordis.patch.yml'))
    } catch {
      return false
    }
  }).sort()
  if (candidates.includes('web')) return 'web'
  return candidates[0]
}

/** Remove one link if it still points at this project; otherwise leave it. */
function unlinkPackage(name) {
  const linkPath = join(modulesRoot, name)
  let st
  try {
    st = lstatSync(linkPath)
  } catch {
    return // Not present: nothing to do.
  }
  if (!st.isSymbolicLink()) {
    console.log(`skip ${name}: ${linkPath} is a real directory (not ours)`)
    return
  }
  try {
    // realpathSync follows the junction to its target: identity check means
    // we only ever remove a link that still points at THIS project.
    const real = realpathSync(linkPath)
    const expected = join(root, 'packages', name === '@ran-sh/dsh-vision' ? 'vision' : 'image-mind')
    const same = real.replaceAll('\\', '/').toLowerCase() === expected.replaceAll('\\', '/').toLowerCase()
    if (!same) {
      console.log(`skip ${name}: link points elsewhere (${real}); leaving it`)
      return
    }
  } catch {
    // A broken link still resolves to a non-existent target; remove it.
  }
  if (dryRun) {
    console.log(`[dry-run] would unlink ${name}`)
    return
  }
  unlinkSync(linkPath)
  console.log(`unlinked ${name}`)
}

/** Remove the installed block from the patch file, preserving everything else. */
function unpatchProfile(profile) {
  const patchPath = join(profilesRoot, profile, 'cordis.patch.yml')
  let text = ''
  try {
    text = readFileSync(patchPath, 'utf8')
  } catch {
    return
  }
  // Remove the block we installed: `# dsh-vision plugin rows ...` comment +
  // the `- insert:` with our two rows. A regex anchored on our own comment
  // keeps unrelated inserts untouched.
  const blockRe = /# dsh-vision plugin rows \(installed by `npm run install:dsh`\)\n- insert:\n(?:\s+- id: (?:vision-runtime|image-mind)\n\s+  name: ['"][^'"]+['"]\n)+/
  if (!blockRe.test(text)) {
    // Older manual installs may lack the comment; fall back to removing the
    // two exact rows if they appear inside a standalone insert.
    const fallback = new RegExp(
      `- insert:\\n(?:\\s+- id: [^\\n]+\\n\\s+  name: [^\\n]+\\n)*?\\s+- id: ${ROW_IDS[0]}\\n\\s+  name: ${JSON.stringify(ROW_NAMES[0])}\\n\\s+- id: ${ROW_IDS[1]}\\n\\s+  name: ${JSON.stringify(ROW_NAMES[1])}\\n`,
    )
    if (!fallback.test(text)) {
      console.log(`no dsh-vision rows found in ${patchPath}; nothing to remove`)
      return
    }
    const next = text.replace(fallback, '')
    if (dryRun) {
      console.log(`[dry-run] would remove dsh-vision rows from ${patchPath}`)
      return
    }
    const backup = `${patchPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    renameSync(patchPath, backup)
    writeFileSync(patchPath, next)
    console.log(`removed dsh-vision rows from ${patchPath} (backup: ${basename(backup)})`)
    return
  }
  const next = text.replace(blockRe, '')
  if (dryRun) {
    console.log(`[dry-run] would remove dsh-vision rows from ${patchPath}`)
    return
  }
  const backup = `${patchPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  renameSync(patchPath, backup)
  writeFileSync(patchPath, next)
  console.log(`removed dsh-vision rows from ${patchPath} (backup: ${basename(backup)})`)
}

/** Remove the image-mind settings section (explicit --purge-settings only). */
function purgeSettingsSection() {
  const settingsPath = join(dshHome, 'settings.yaml')
  let text = ''
  try {
    text = readFileSync(settingsPath, 'utf8')
  } catch {
    console.log(`no ${settingsPath}; nothing to purge`)
    return
  }
  // Remove a top-level `image-mind:` section and its body: collect every
  // following line until the next top-level key (indent-zero). Nested maps
  // and one-liners both covered; sibling sections survive.
  const lines = text.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^image-mind:/.test(lines[i])) { start = i; break }
  }
  if (start < 0) {
    console.log('no image-mind section in settings.yaml; nothing to purge')
    return
  }
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.length > 0 && !/^[ \t]/.test(line)) break
    end++
  }
  const next = lines.slice(0, start).concat(lines.slice(end)).join('\n').replace(/\n{3,}/g, '\n\n')
  const backup = `${settingsPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  renameSync(settingsPath, backup)
  writeFileSync(settingsPath, next)
  console.log(`removed image-mind section from ${settingsPath} (backup: ${basename(backup)})`)
}

console.log(`DSH_HOME: ${dshHome}${dryRun ? ' [dry-run]' : ''}`)
if (!existsSync(profilesRoot)) {
  console.log(`no Harness profiles found under ${profilesRoot}; nothing to uninstall`)
  process.exit(0)
}

for (const name of LINK_NAMES) unlinkPackage(name)

// Clean up the scoped parent directory only when WE emptied it and nothing
// else lives there; a directory with other scoped packages is never touched.
const scopeDir = join(modulesRoot, '@ran-sh')
try {
  if (existsSync(scopeDir) && readdirSync(scopeDir).length === 0) {
    if (dryRun) {
      console.log(`[dry-run] would remove empty ${scopeDir}`)
    } else {
      rmdirSync(scopeDir)
      console.log(`removed empty ${scopeDir}`)
    }
  }
} catch {
  // A non-empty or locked directory is left alone.
}

const profile = pickProfile()
if (profile !== undefined) unpatchProfile(profile)

if (purgeSettings) {
  purgeSettingsSection()
} else {
  console.log('settings kept (pass --purge-settings to also remove the image-mind provider configuration)')
}

console.log('\ndone. Restart the web profile to drop the plugin.')
