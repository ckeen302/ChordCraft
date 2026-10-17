import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    include: ['**/*.test.ts'],
    // Skip hidden folders (build output, local tool worktrees with their own
    // node_modules) so only this repo's tests run.
    exclude: ['**/node_modules/**', '**/.*/**'],
  },
})
