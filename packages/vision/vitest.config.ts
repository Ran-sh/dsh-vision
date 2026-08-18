/**
 * Vitest configuration for @ran-sh/dsh-vision. Tests import source directly
 * and stub nothing beyond the Cordis context; the @deepseek-ai/* types resolve
 * through the root workspace node_modules junction.
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/cordis': resolve(import.meta.dirname, '../../node_modules/@deepseek-ai/cordis'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
