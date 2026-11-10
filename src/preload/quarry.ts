// The preload of the Quarry page's view (a <webview> on quarry://app/): Quarry's UI looks for window.quarryHost and
// talks through it (Quarry's docs/embedding.md). Main only answers quarry:invoke from this view. A failed call comes
// back as { ok: false, error } and is thrown as Quarry's own ApiError object, which is what its UI expects.
import { contextBridge, ipcRenderer } from 'electron'

// the theme and fonts Hive's page passes in the address (pages/QuarryPage.tsx); later changes come through
// window.quarrySetTheme / quarrySetFonts, which the page calls in this view
const q = new URLSearchParams(location.search)
const theme = q.get('theme') || undefined
const fonts = { ...(q.get('ui') ? { ui: q.get('ui')! } : {}), ...(q.get('code') ? { code: q.get('code')! } : {}) }

contextBridge.exposeInMainWorld('quarryHost', {
  invoke: async (method: string, params: object) => {
    const r = await ipcRenderer.invoke('quarry:invoke', String(method), params ?? {})
    if (r && r.ok === false) throw r.error
    return r?.value
  },
  // CSV export: where to save it (null = cancelled)
  saveFile: (defaultName: string): Promise<string | null> => ipcRenderer.invoke('quarry:saveFile', String(defaultName ?? 'export.csv')),
  ...(theme ? { theme } : {}),
  // Hive's own fonts (Settings > Appearance): each wins over the font the user stored in Quarry, and is not saved there
  ...(fonts.ui || fonts.code ? { fonts } : {}),
})
