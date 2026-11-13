// Windows toast + taskbar flash when a thread needs the user and Orbit is not the focused window.
// Same events as the phone (see notifyUser in chat.ts); clicking the toast opens that thread.
import { BrowserWindow, Notification } from 'electron'
import { currentSettings } from './settings'
import { TEST_MODE } from './testMode'
import { inQuiet, quietHours } from './quietHours'
import { noteKind } from '../shared/phoneCore'

type Open = (threadId: string) => void
let getWin: () => BrowserWindow | null = () => null
let open: Open = () => {}

export function initDesktopNotify(win: () => BrowserWindow | null, onOpen: Open): void {
  getWin = win
  open = onOpen
}

export function notifyDesktop(title: string, body: string, thread?: string): void {
  if (TEST_MODE || currentSettings()?.general.desktopNotify === false) return
  const win = getWin()
  if (!win || win.isDestroyed() || win.isFocused()) return // the user is looking at Orbit already
  if (Notification.isSupported()) {
    // quiet hours: no sound, except for a failure
    const n = new Notification({ title, body, silent: inQuiet(quietHours(), new Date()) && noteKind(title) !== 'fail' })
    n.on('click', () => open(thread ?? ''))
    n.show()
  }
  win.flashFrame(true)
  win.once('focus', () => win.flashFrame(false)) // stops flashing once the user comes back
}
