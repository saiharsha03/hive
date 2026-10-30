// Bridge between the UI and the main process.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  sessionStats: (path: string) => ipcRenderer.invoke('session:stats', path),
  getStatus: () => ipcRenderer.invoke('status:get'),
  listDir: (dir: string) => ipcRenderer.invoke('fs:list', dir),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  listHooks: (folder: string) => ipcRenderer.invoke('hooks:list', folder),
  setHook: (folder: string, id: string, enabled: boolean) => ipcRenderer.invoke('hooks:set', folder, id, enabled),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  setPlugin: (key: string, on: boolean) => ipcRenderer.invoke('plugins:set', key, on),
  readText: (path: string) => ipcRenderer.invoke('fs:readText', path),
  chatSend: (tabId: string, cwd: string, resume: string | undefined, msg: unknown) => ipcRenderer.invoke('chat:send', tabId, cwd, resume, msg),
  chatInterrupt: (tabId: string) => ipcRenderer.invoke('chat:interrupt', tabId),
  chatClose: (tabId: string) => ipcRenderer.invoke('chat:close', tabId),
  chatReset: () => ipcRenderer.invoke('chat:reset'),
  previewUrl: (path: string) => ipcRenderer.invoke('preview:url', path),
  chatMode: () => ipcRenderer.invoke('chat:mode'),
  homeDir: () => ipcRenderer.invoke('app:home'),
  loadHistory: (path: string) => ipcRenderer.invoke('history:load', path),
  // every event from every live session: (tabId, event)
  onChatEvent: (cb: (tabId: string, event: any) => void) => {
    const fn = (_e: unknown, tabId: string, event: any) => cb(tabId, event)
    ipcRenderer.on('chat:event', fn)
    return () => ipcRenderer.removeListener('chat:event', fn)
  },
  openExternal: (path: string) => ipcRenderer.invoke('shell:open', path),
})
