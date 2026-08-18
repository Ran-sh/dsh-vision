/**
 * Root Vitest configuration for the cross-package composition tests: loads
 * the @ran-sh/dsh-vision service package and the dsh-plugin-image-mind
 * provider package through the real Cordis Loader.
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@ran-sh/dsh-vision': resolve(import.meta.dirname, 'packages/vision/src/index.ts'),
      '@deepseek-ai/cordis': resolve(import.meta.dirname, 'node_modules/@deepseek-ai/cordis'),
      '@deepseek-ai/cordis-plugin-loader': resolve(import.meta.dirname, 'node_modules/@deepseek-ai/cordis-plugin-loader'),
      '@deepseek-ai/cordis-plugin-include': resolve(import.meta.dirname, 'node_modules/@deepseek-ai/cordis-plugin-include'),
      '@deepseek-ai/dsh-settings': resolve(import.meta.dirname, 'node_modules/@deepseek-ai/dsh-settings'),
      '@deepseek-ai/dsh-credentials': resolve(import.meta.dirname, 'node_modules/@deepseek-ai/dsh-credentials'),
      '@deepseek-ai/dsh-launch-environment': resolve(import.meta.dirname, 'node_modules/@deepseek-ai/dsh-launch-environment'),
      '@deepseek-ai/dsh-attachment': resolve(import.meta.dirname, 'node_modules/@deepseek-ai/dsh-attachment'),
      '@deepseek-ai/dsh-tools': resolve(import.meta.dirname, 'node_modules/@deepseek-ai/dsh-tools'),
      'schemastery': resolve(import.meta.dirname, 'node_modules/schemastery'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
