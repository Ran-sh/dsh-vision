/**
 * `npm run diagnose:dsh` — report the plugin's installation state without
 * changing anything. Prints DSH_HOME, profile candidates, the chosen
 * profile, build status, link status for both packages, the patch rows, and
 * the settings transport capability. NEVER prints credential values, API
 * keys, or full settings.
 */
import { existsSync, readdirSync, lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0
  ? process.env.DSH_HOME
  : join(process.env.USERPROFILE ?? homedir(), '.dsh')
const profilesRoot = join(dshHome, 'profiles')
const modulesRoot = join(profilesRoot, 'node_modules')

console.log(`DSH_HOME: ${dshHome}`)

if (!existsSync(profilesRoot)) {
  console.log('profiles: none (Harness not installed here)')
  process.exit(0)
}

const candidates = readdirSync(profilesRoot).filter(entry => {
  try {
    return lstatSync(join(profilesRoot, entry)).isDirectory() && existsSync(join(profilesRoot, entry, 'cordis.patch.yml'))
  } catch {
    return false
  }
}).sort()
console.log(`profile candidates: ${candidates.length > 0 ? candidates.join(', ') : 'none'}`)
const chosen = candidates.includes('web') ? 'web' : candidates.length === 1 ? candidates[0] : undefined
console.log(`chosen profile: ${chosen ?? '(ambiguous — pass --profile)'}`)

// Build status.
for (const [name, dir] of [['@ran-sh/dsh-vision', 'vision'], ['dsh-plugin-image-mind', 'image-mind']]) {
  const built = join(root, 'packages', dir, 'lib', 'index.js')
  console.log(`${name} build: ${existsSync(built) ? 'built' : 'MISSING (run npm run build)'}`)
}

// Link status.
for (const name of ['@ran-sh/dsh-vision', 'dsh-plugin-image-mind']) {
  const link = join(modulesRoot, name)
  let state = 'not installed'
  try {
    const st = lstatSync(link)
    if (st.isSymbolicLink()) {
      const target = resolve(link)
      state = `linked -> ${target}${target.includes('dsh-vision') ? ' (this project)' : ' (OTHER target!)'}`
    } else if (st.isDirectory()) {
      state = 'real directory (not ours)'
    }
  } catch {
    state = 'not installed'
  }
  console.log(`${name} link: ${state}`)
}

// Patch rows.
if (chosen !== undefined) {
  const patchPath = join(profilesRoot, chosen, 'cordis.patch.yml')
  let rows = 'none'
  try {
    const text = readFileSync(patchPath, 'utf8')
    const hasVision = /- id: vision-runtime/.test(text)
    const hasImageMind = /- id: image-mind/.test(text)
    rows = hasVision && hasImageMind ? 'both present' : hasVision || hasImageMind ? 'PARTIAL' : 'none'
  } catch {
    rows = 'unreadable'
  }
  console.log(`cordis rows: ${rows}`)
}

console.log('settings transport: official seam (settings.describe/mutate) — verified at runtime by the card')
console.log('credential values: never printed')
