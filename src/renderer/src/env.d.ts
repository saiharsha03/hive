/// <reference types="vite/client" />

type SessionInfo = { id: string; title: string; project: string; cwd: string; updated: number; started: number; path: string }

type Limit = { pct: number | null; resetsAt: string | null } | null
type Status = {
  account: string | null
  plan: string | null
  five: Limit
  seven: Limit
  connectors: { connected: number; total: number; needsAuth: number; failed: number } | null
  error?: string
}
type SessionStats = {
  model: string | null
  contextTokens: number | null
  lastReplyAt: number | null
  cacheTtlMs: number
  startedAt: number | null
  compactions: number
}

type FsEntry = { name: string; path: string; dir: boolean }
type Item =
  | { kind: 'user'; text: string; images: string[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; input: any; status: 'running' | 'done' | 'error' }
  | { kind: 'show'; path: string }
  | { kind: 'error'; text: string }
  | { kind: 'note'; text: string }
type Outgoing = { text: string; images: { mediaType: string; data: string }[] }
type PluginInfo = { key: string; name: string; source: string; description: string; events: string[]; mod: boolean; enabled: boolean }
type HookRow = {
  id: string
  scope: 'User' | 'Project' | 'Local'
  file: string
  event: string
  matcher: string
  command: string
  name: string
  enabled: boolean
}

interface Window {
  api: {
    listSessions: () => Promise<SessionInfo[]>
    sessionStats: (path: string) => Promise<SessionStats>
    getStatus: () => Promise<Status>
    listDir: (dir: string) => Promise<FsEntry[]>
    pickFolder: () => Promise<string | null>
    listHooks: (folder: string) => Promise<HookRow[]>
    setHook: (folder: string, id: string, enabled: boolean) => Promise<void>
    listPlugins: () => Promise<PluginInfo[]>
    setPlugin: (key: string, on: boolean) => Promise<void>
    readText: (path: string) => Promise<string>
    chatSend: (tabId: string, cwd: string, resume: string | undefined, msg: Outgoing) => Promise<void>
    chatInterrupt: (tabId: string) => Promise<void>
    chatClose: (tabId: string) => Promise<void>
    chatReset: () => Promise<void>
    previewUrl: (path: string) => Promise<string>
    chatMode: () => Promise<string>
    homeDir: () => Promise<string>
    loadHistory: (path: string) => Promise<Item[]>
    onChatEvent: (cb: (tabId: string, event: any) => void) => () => void
    openExternal: (path: string) => Promise<string>
  }
}
