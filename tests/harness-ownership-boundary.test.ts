/**
 * DeepSeek Harness ownership boundary.
 *
 * dsh-vision is a plugin. It may READ Harness state for diagnostics and may
 * ship its own plugin metadata, but project code must never directly mutate
 * Harness-owned profiles, DSH_HOME, cordis.patch.yml, lockfiles, or settings.
 * Installation/removal is the Harness plugin manager's responsibility and is
 * initiated outside this repository's scripts.
 *
 * This regression exists because an early development-only install:dsh path
 * directly rewrote a profile cordis.patch.yml and was later removed. Keep
 * that class of integration out of this plugin permanently.
 * @vitest-environment node
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const scriptsRoot = resolve(root, 'scripts')

function productionScripts(): string[] {
  return readdirSync(scriptsRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:mjs|cjs|js|ts)$/.test(entry.name))
    .map(entry => resolve(scriptsRoot, entry.name))
}

const harnessOwnedState = /\bDSH_HOME\b|(?:profilesRoot|profileRoot)|cordis\.patch\.ya?ml|(?:^|[\\/'"`])profiles[\\/'"`]|settings\.ya?ml|pnpm-lock\.ya?ml/i
const mutatingFsCall = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|truncate|truncateSync|rename|renameSync|copyFile|copyFileSync|unlink|unlinkSync|rm|rmSync|mkdir|mkdirSync|symlink|symlinkSync|link|linkSync)\s*\(/
const pluginMutationCommand = /(?:\bdsh\b|@deepseek-ai\/dsh)[^\n]{0,120}\bplugin\b[^\n]{0,80}\b(?:add|remove)\b/i

describe('DeepSeek Harness ownership boundary', () => {
  it('root scripts expose no project-owned DSH install/uninstall/repair command', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const scripts = pkg.scripts ?? {}
    const forbiddenNames = Object.keys(scripts).filter(name => /(?:install|uninstall|setup|repair|patch):dsh|dsh:(?:install|uninstall|setup|repair|patch)/i.test(name))
    expect(forbiddenNames, `project scripts must not own Harness installation/profile repair: ${forbiddenNames.join(', ')}`).toEqual([])

    const mutatingCommands = Object.entries(scripts)
      .filter(([, command]) => pluginMutationCommand.test(command))
      .map(([name]) => name)
    expect(mutatingCommands, `project scripts must not run Harness plugin add/remove: ${mutatingCommands.join(', ')}`).toEqual([])
  })

  it('production scripts never combine Harness-owned paths with filesystem mutation', () => {
    const offenders: string[] = []
    for (const file of productionScripts()) {
      const text = readFileSync(file, 'utf8')
      if (harnessOwnedState.test(text) && mutatingFsCall.test(text)) {
        offenders.push(file.slice(root.length + 1).replaceAll('\\', '/'))
      }
    }
    expect(
      offenders,
      `dsh-vision is a plugin; scripts may inspect Harness state but must not write it: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('production scripts never invoke Harness plugin add/remove as a side effect', () => {
    const offenders = productionScripts()
      .filter(file => pluginMutationCommand.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(root.length + 1).replaceAll('\\', '/'))
    expect(offenders, `plugin installation/removal belongs to Harness, not project scripts: ${offenders.join(', ')}`).toEqual([])
  })

  it('diagnose:dsh remains read-only', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(pkg.scripts?.['diagnose:dsh']).toBe('node scripts/diagnose-dsh.mjs')

    const text = readFileSync(resolve(scriptsRoot, 'diagnose-dsh.mjs'), 'utf8')
    expect(text).toMatch(/readFileSync/)
    expect(text).toMatch(/\bDSH_HOME\b/)
    expect(text).not.toMatch(mutatingFsCall)
    expect(text).not.toMatch(pluginMutationCommand)
  })
})
