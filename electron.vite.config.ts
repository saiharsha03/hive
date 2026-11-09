import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { version } from './package.json'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],

    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  // no live reload: a reload restarts every running session, so the window only updates on Ctrl+R
  renderer: { plugins: [react()], server: { hmr: false }, define: { __APP_VERSION__: JSON.stringify(version) } },
})
