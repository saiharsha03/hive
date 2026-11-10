// The preload of the Quarry page's view (a <webview> on quarry://app/): Quarry's UI looks for window.quarryHost and
// talks through it (Quarry's docs/embedding.md). Main only answers quarry:invoke from this view. A failed call comes
// back as { ok: false, error } and is thrown as Quarry's own ApiError object, which is what its UI expects.
import { contextBridge, ipcRenderer } from 'electron'

const q = new URLSearchParams(location.search)
const theme = q.get('theme') || undefined

contextBridge.exposeInMainWorld('quarryHost', {
  invoke: async (method: string, params: object) => {
    const r = await ipcRenderer.invoke('quarry:invoke', String(method), params ?? {})
    if (r && r.ok === false) throw r.error
    return r?.value
  },
  // CSV export: where to save it (null = cancelled)
  saveFile: (defaultName: string): Promise<string | null> => ipcRenderer.invoke('quarry:saveFile', String(defaultName ?? 'export.csv')),
  ...(theme ? { theme } : {}),
  // Hive's own type: Space Grotesk and Space Mono (each wins over the font the user stored in Quarry, not saved)
  fonts: { ui: 'space-grotesk', code: 'space-mono' },
})
