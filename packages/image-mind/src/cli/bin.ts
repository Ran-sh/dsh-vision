#!/usr/bin/env node
/**
 * npm bin entry for dsh-plugin-image-mind (`npx dsh-plugin-image-mind ...`).
 *
 * Thin executable shell around the lifecycle CLI; the running version is
 * read from this package's manifest so install/update always target the
 * exact published artifact the user executed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { main } from './main.ts'

function runningVersion(): string {
  const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string }
  return raw.version ?? '0.0.0'
}

main(process.argv.slice(2), runningVersion()).then((code) => process.exit(code))
