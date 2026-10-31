import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // the embedding worker is its own file, loaded by search.ts as a worker thread
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), searchWorker: resolve('src/main/searchWorker.ts') } } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  // no live reload: a reload restarts every running session, so the window only updates on Ctrl+R
  renderer: { plugins: [react()], server: { hmr: false } },
})
