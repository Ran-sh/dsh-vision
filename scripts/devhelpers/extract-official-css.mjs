// Extract the official PluginCard / fields CSS from the settings-plugins client bundle.
import { readFileSync } from 'node:fs'

const src = readFileSync('C:/Users/48376/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js', 'utf8')
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