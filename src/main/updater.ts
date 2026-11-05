// Updates from GitHub Releases. The installer build downloads a new release in the background (electron-updater,
// latest.yml next to the installer) and installs it on quit or on "Restart to update". The portable build cannot
// replace itself, so it only checks the latest release and links to it. Errors are logged, never shown.
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { isNewer, type UpdateState } from '../shared/versionCore'

const RELEASES = 'https://api.github.com/repos/saiharsha03/hive/releases/latest'
const EVERY_MS = 6 * 60 * 60_000
const portable = () => !!process.env.PORTABLE_EXECUTABLE_DIR

let state: UpdateState | null = null
let notify: (s: UpdateState) => void = () => {}
const set = (s: UpdateState) => { state = s; notify(s) }

export const updateState = (): UpdateState | null => state

async function checkPortable(): Promise<void> {
  const res = await fetch(RELEASES, { headers: { 'User-Agent': 'Hive', Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`)
  const r = (await res.json()) as { tag_name?: string; html_url?: string }
  if (r.tag_name && r.html_url && isNewer(r.tag_name, app.getVersion())) set({ kind: 'available', version: r.tag_name.replace(/^v/i, ''), url: r.html_url })
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  try {
    if (portable()) await checkPortable()
    else await autoUpdater.checkForUpdates()
  } catch (e) {
    console.warn('[updater]', (e as Error)?.message ?? e)
  }
}

export function startUpdater(onChange: (s: UpdateState) => void): void {
  notify = onChange
  if (!app.isPackaged) return
  if (!portable()) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-downloaded', (info) => set({ kind: 'ready', version: info.version }))
    autoUpdater.on('error', (e) => console.warn('[updater]', e?.message ?? e))
  }
  void checkForUpdates()
  setInterval(() => void checkForUpdates(), EVERY_MS).unref?.()
}

// the status bar item: restart into the downloaded update, or (portable) open that release's page
export function applyUpdate(): boolean {
  if (state?.kind === 'ready') { autoUpdater.quitAndInstall(); return true }
  if (state?.kind === 'available') void shell.openExternal(state.url)
  return false
}
