// Extract the official PluginCard / fields CSS from the settings-plugins client bundle.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js'), 'utf8')
const re = /const (css\$\d*|css) = "((?:[^"\\]|\\.)*)"/g
let m
while ((m = re.exec(src)) !== null) {
  const txt = m[2]
  if (/YyYd_a_|At1oFq_/.test(txt)) {
    console.log('===== ' + m[1] + ' =====')
    console.log(txt.split('}').join('}\n'))
    console.log()
  }
}