/**
 * Vitest configuration for dsh-plugin-image-mind. Tests import plugin source
 * directly (the `.ts` paths resolve through the host tsconfig), and stub the
 * few DSH services they touch (settings, credentials) rather than booting a
 * full harness. Node environment; no browser tests here.
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const DEEPSEEK_AI = resolve(import.meta.dirname, 'node_modules/@deepseek-ai')

export default defineConfig({
  resolve: {
    alias: {
      // Exact package aliases to the project's @deepseek-ai tree (a junction
      // to the installed DSH profile; the tsconfig `paths` map points here
      // too). No machine-specific absolute paths in this repository.
      '@deepseek-ai/cordis': resolve(DEEPSEEK_AI, 'cordis'),
      '@deepseek-ai/dsh-credentials': resolve(DEEPSEEK_AI, 'dsh-credentials'),
      '@deepseek-ai/dsh-launch-environment': resolve(DEEPSEEK_AI, 'dsh-launch-environment'),
      '@deepseek-ai/dsh-settings': resolve(DEEPSEEK_AI, 'dsh-settings'),
      '@deepseek-ai/dsh-attachment': resolve(DEEPSEEK_AI, 'dsh-attachment'),
      'schemastery': resolve(import.meta.dirname, 'node_modules/schemastery'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
