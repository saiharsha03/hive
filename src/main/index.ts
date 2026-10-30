// Electron main process. The Agent SDK runs here.
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeAll, closeTab, interrupt, PERMISSION_MODE, sendMessage, type Outgoing } from './chat'
import { listDir } from './files'
import { loadHistory } from './history'
import { listHooks, listPlugins, setHook, setPlugin } from './hooks'
import { handleScheme, openExternal, previewUrl, readText, registerScheme, SCHEME } from './preview'
import { listSessions } from './sessions'
import { sessionStats } from './sessionStats'
import { closeStatus, getStatus } from './status'

registerScheme()

// The app's own page: the dev server in development, the built index.html otherwise.
const DEV_URL = process.env.ELECTRON_RENDERER_URL
const APP_HTML = join(__dirname, '../renderer/index.html')
// compare parsed origins / the exact file, never string prefixes ("http://localhost:5173@evil.example")
function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (DEV_URL) return u.origin === new URL(DEV_URL).origin
    return u.protocol === 'file:' && `${u.origin}${u.pathname}` === `${new URL(pathToFileURL(APP_HTML).href).origin}${new URL(pathToFileURL(APP_HTML).href).pathname}`
  } catch {
    return false
  }
}

// Every IPC call must come from the app's own top-level page, never from a preview frame
// or from a page the window was somehow navigated to.
function handle(channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (e.senderFrame !== e.sender.mainFrame || !isAppUrl(e.senderFrame?.url ?? '')) throw new Error('Not allowed')
    return fn(e, ...args)
  })
}

handle('sessions:list', () => listSessions())
handle('session:stats', (_e, path: string) => sessionStats(path))
handle('status:get', () => getStatus())
handle('fs:list', (_e, dir: string) => listDir(dir))
handle('hooks:list', (_e, folder: string) => listHooks(folder))
handle('hooks:set', (_e, folder: string, id: string, enabled: boolean) => setHook(folder, id, enabled))
handle('plugins:list', () => listPlugins())
handle('plugins:set', (_e, key: string, on: boolean) => setPlugin(key, on))
handle('chat:send', (e, tabId: string, cwd: string, resume: string | undefined, msg: Outgoing) => sendMessage(tabId, cwd, resume, msg, e.sender))
handle('chat:interrupt', (_e, tabId: string) => interrupt(tabId))
handle('chat:close', (_e, tabId: string) => closeTab(tabId))
// the page (re)loaded: no tab is showing any live session any more, so stop them all
handle('chat:reset', () => closeAll())
handle('chat:mode', () => PERMISSION_MODE)
handle('app:home', () => app.getPath('home'))
handle('history:load', (_e, path: string) => loadHistory(path))
handle('fs:readText', (_e, path: string) => readText(path))
handle('preview:url', (_e, path: string) => previewUrl(path))
handle('shell:open', (_e, path: string) => openExternal(path))
handle('dialog:folder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

// web links open in the browser
const openInBrowser = (url: string) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url) }

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1f1f1f',
    // our own top bar in the UI; Windows keeps only min / max / close
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#181818', symbolColor: '#cccccc', height: 34 },
    // plugins: Chromium's built-in PDF viewer for the Preview panel
    webPreferences: { preload: join(__dirname, '../preload/index.js'), plugins: true },
  })
  const web = win.webContents
  // the window only ever shows the app; links in chat replies go to the browser instead
  web.on('will-navigate', (e, url) => { if (!isAppUrl(url)) { e.preventDefault(); openInBrowser(url) } })
  web.on('will-redirect', (e, url) => { if (!isAppUrl(url)) e.preventDefault() })
  // preview frames may only show local previews, never navigate off to a website
  web.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && !e.url.startsWith(`${SCHEME}:`) && !e.url.startsWith('about:')) e.preventDefault()
  })
  web.setWindowOpenHandler(({ url }) => { openInBrowser(url); return { action: 'deny' } })

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(APP_HTML)
}

Menu.setApplicationMenu(null)
app.whenReady().then(() => {
  handleScheme()
  createWindow()
})
app.on('window-all-closed', () => {
  closeStatus()
  closeAll()
  app.quit()
})
