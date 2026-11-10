// Pure decisions for the main window (no Electron imports, so they can be tested): what a key does, when the page is
// ready to be handed threads, and which folder a phone may start a thread in.
import { posix, win32 } from 'node:path'

export type KeyInput = { type: string; key: string; control: boolean; shift: boolean }
export type KeyAction = 'reload' | 'devtools' | 'quit' | null

// The app menu is removed (own top bar), which also removed its shortcuts. Reload (Ctrl+R, F5) only while developing:
// in the built app it reloaded the page from anywhere, the terminal too, and the reloaded page stops every live thread
// and terminal. Dev tools (Ctrl+Shift+I) and Quit (Ctrl+Q) always.
export function keyAction(input: KeyInput, dev: boolean): KeyAction {
  if (input.type !== 'keyDown') return null
  const key = input.key.toLowerCase()
  if (dev && ((input.control && !input.shift && key === 'r') || key === 'f5')) return 'reload'
  if (input.control && input.shift && key === 'i') return 'devtools'
  if (input.control && !input.shift && key === 'q') return 'quit'
  return null
}

// The page is ready for threads only once it has started and said so: its first effect calls chat:reset, which stops
// every live thread, so a thread started between "page loaded" and that reset was killed at once. Loading again
// (a reload, a crash) makes it not ready until the next reset.
export function readyGate() {
  let ready = false
  return {
    loading: () => { ready = false },
    reset: () => { ready = true },
    ready: () => ready,
  }
}

// a phone may start a thread only in a folder the app offered it (the workspace root or a repo under it): that folder,
// as the app spelled it, or null for anything else
export function phoneFolder(folder: string, offered: string[], win = process.platform === 'win32'): string | null {
  const norm = (p: string) => (win ? win32.resolve(p).toLowerCase() : posix.resolve(p))
  const want = norm(folder)
  return offered.find((f) => norm(f) === want) ?? null
}
