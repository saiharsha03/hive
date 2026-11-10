import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    // main-process modules import electron; tests run in plain Node with a small stub instead
    alias: { electron: resolve('test/support/electron.ts') },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/support/setup.ts'],
    // the git and pty integration tests spawn real processes
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
