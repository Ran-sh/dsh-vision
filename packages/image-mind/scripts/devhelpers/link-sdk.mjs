/**
 * Dev-only SDK link helper for the DSH web profile.
 *
 * Since the workspace declares the @deepseek-ai SDK as real registry
 * dependencies, `npm install` provides everything typecheck/tests/build need
 * with NO junction into the DSH profile tree — `npm install`/`prune` can
 * never touch the profile SDK (the historical junction failure mode).
 *
 * This helper remains only for the "run inside the live DSH profile" dev
 * loop: when the profile's @deepseek-ai tree contains packages this project
 * does not (e.g. client bundles the harness ships), a junction fills the gap.
 * It never removes or overwrites anything; `npm install` does not follow it
 * because the registry copy of the SDK already satisfies every declared
 * dependency.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const localLink = join(root, 'node_modules', '@deepseek-ai')
const profileSdk = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai')
  : join(process.env.USERPROFILE ?? homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai')

const remove = process.argv.includes('--remove')
if (remove) {
  // Remove ONLY the junction entries this helper created (a registry copy of
  // the package already satisfies the dependency; the junction is a pure
  // supplement). Never touch the profile SDK tree itself.
  if (existsSync(localLink)) {
    const entries = readdirSync(localLink)
    for (const entry of entries) {
      const link = join(localLink, entry)
      const st = lstatSync(link)
      if (st.isSymbolicLink()) unlinkSync(link)
    }
    console.log(`removed supplement junctions under ${localLink}`)
  } else {
    console.log('nothing to remove')
  }
  process.exit(0)
}

if (!existsSync(profileSdk)) {
  console.error(`profile SDK not found under ${profileSdk}; set DSH_HOME if your Harness home differs.`)
  process.exit(1)
}

// Link only what the profile has and the local tree lacks. The local tree is
// npm-owned: nothing here may overwrite or remove a registry-installed copy.
const profileEntries = readdirSync(profileSdk)
const localEntries = existsSync(localLink) ? readdirSync(localLink) : []
let linked = 0
for (const entry of profileEntries) {
  if (localEntries.includes(entry)) continue
  const link = join(localLink, entry)
  const target = join(profileSdk, entry)
  mkdirSync(localLink, { recursive: true })
  const result = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `New-Item -ItemType Junction -Path '${link.replaceAll('/', '\\')}' -Target '${target.replaceAll('/', '\\')}' | Out-Null`,
  ], { stdio: 'pipe' })
  if (result.status === 0) {
    linked += 1
  } else {
    console.log(`skip ${entry}: junction failed (${String(result.stderr).trim()})`)
  }
}
console.log(linked > 0
  ? `linked ${linked} supplement junction(s) (profile-only packages)`
  : 'all SDK packages already present locally; nothing to link')
