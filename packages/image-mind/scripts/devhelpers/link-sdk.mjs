/**
 * Re-create the runtime @deepseek-ai junction this package needs. At server
 * time the plugin's lib/index.js lives in the project dir, so Node resolves
 * its @deepseek-ai/* imports from THIS package's node_modules — the build's
 * tsconfig paths cover type-check only. The junction points at the DSH
 * profile tree (itself junctions into the app cache), so no copies are made.
 *
 * SAFETY: npm install / prunes walk node_modules and follow junctions, which
 * would empty the profile SDK tree. Run `node scripts/devhelpers/link-sdk.mjs
 * --remove` BEFORE any npm install, then recreate afterwards.
 */
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const link = join(root, 'node_modules', '@deepseek-ai')
const target = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai')
  : join(process.env.USERPROFILE ?? homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai')

const remove = process.argv.includes('--remove')
if (remove) {
  if (existsSync(link)) {
    rmSync(link, { recursive: true, force: true })
    console.log(`removed: ${link}`)
  } else {
    console.log('nothing to remove')
  }
  process.exit(0)
}

if (existsSync(link)) {
  console.log(`exists: ${link}`)
  process.exit(0)
}
if (!existsSync(join(target, 'dsh-tools'))) {
  console.error(`SDK not found under ${target}; expected '{USERPROFILE}/.dsh/profiles/node_modules/@deepseek-ai'. Set DSH_HOME if your Harness home differs.`)
  process.exit(1)
}
mkdirSync(dirname(link), { recursive: true })
const result = spawnSync('powershell', [
  '-NoProfile', '-NonInteractive', '-Command',
  `New-Item -ItemType Junction -Path '${link.replaceAll('/', '\\')}' -Target '${target.replaceAll('/', '\\')}' | Out-Null`,
], { stdio: 'inherit' })
if (result.status !== 0) {
  console.error('failed to junction @deepseek-ai')
  process.exit(1)
}
console.log(`linked: ${link} -> ${target}`)
