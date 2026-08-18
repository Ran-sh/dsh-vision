/**
 * Vitest configuration for dsh-plugin-image-mind. Tests import source directly
 * and stub the few DSH services they touch (settings, credentials) rather
 * than booting a full harness. The @ran-sh/dsh-vision workspace package and
 * the @deepseek-ai/* SDK resolve through the root workspace node_modules.
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@ran-sh/dsh-vision': resolve(import.meta.dirname, '../vision/src/index.ts'),
      '@deepseek-ai/cordis': resolve(import.meta.dirname, '../../node_modules/@deepseek-ai/cordis'),
      '@deepseek-ai/dsh-credentials': resolve(import.meta.dirname, '../../node_modules/@deepseek-ai/dsh-credentials'),
      '@deepseek-ai/dsh-launch-environment': resolve(import.meta.dirname, '../../node_modules/@deepseek-ai/dsh-launch-environment'),
      '@deepseek-ai/dsh-settings': resolve(import.meta.dirname, '../../node_modules/@deepseek-ai/dsh-settings'),
      '@deepseek-ai/dsh-attachment': resolve(import.meta.dirname, '../../node_modules/@deepseek-ai/dsh-attachment'),
      '@deepseek-ai/dsh-tools': resolve(import.meta.dirname, '../../node_modules/@deepseek-ai/dsh-tools'),
      'schemastery': resolve(import.meta.dirname, '../../node_modules/schemastery'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
