/// <reference types="vite/client" />

type SessionInfo = { id: string; title: string; project: string; cwd: string; updated: number; started: number; path: string }

type SearchResult = { mode: 'hybrid' | 'bm25'; indexing: { indexed: number; total: number } | null; results: { sessionId: string; score: number; snippet: string }[] }
type SearchStatus = { indexed: number; total: number; model: 'idle' | 'loading' | 'ready' | 'failed'; done: boolean }

type Limit = { pct: number | null; resetsAt: string | null } | null
type Status = {
  account: string | null
  plan: string | null
  five: Limit
  seven: Limit
  connectors: { connected: number; total: number; needsAuth: number; failed: number } | null
  engine: { installed: boolean; version: string | null }
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
  | { kind: 'user'; text: string; images: string[]; steer?: boolean; during?: string; queue?: { id: string; pending: boolean } }
  | { kind: 'assistant'; text: string }
  // patch: Claude Code's structuredPatch from an Edit / MultiEdit / Write result, for the diff
  | { kind: 'tool'; id: string; name: string; input: any; status: 'running' | 'done' | 'error'; patch?: unknown }
  | { kind: 'show'; path: string }
  | { kind: 'error'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'agent'; from: string; text: string } // a message another agent sent in (e.g. Codex via codex-panel)
  // a message another Hive thread sent in (message_thread / start_thread)
  | { kind: 'thread'; fromId: string; fromTitle: string; text: string; steer?: boolean; queue?: { id: string; pending: boolean } }
  // a Codex subagent run started through the codex tool, streamed live
  | { kind: 'codex'; id: string; task: string; model: string; allowEdits: boolean; status: 'running' | 'done' | 'error'; lines: string[]; answer: string }
  | { kind: 'summary'; text: string } // the compaction summary a continued conversation starts from, shown collapsed
  | { kind: 'warning'; event: string; name: string; text: string } // what a hook said (e.g. a security warning on an edit)
type McpServerRow = { name: string; status: string; source: string; error?: string; tools: number | null }
type Outgoing = { title?: string; text: string; images: { mediaType: string; data: string }[]; mode?: 'steer' | 'queue'; queueId?: string; background?: boolean }
type WorktreeLink = import('../../shared/worktreeCore').WorktreeLink
type PluginInfo = { key: string; name: string; source: string; description: string; events: string[]; mod: boolean; enabled: boolean }
type TodoStatus = 'todo' | 'talk' | 'holding' | 'done'
type Todo = { id: string; text: string; status: TodoStatus; done: boolean; due?: string; createdAt: number; doneAt?: number; source?: 'user' | 'claude' }

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

type DeployWatcher = { id: string; repo: string; sha: string; state: 'working' | 'waiting'; note: string; stuck: boolean; landed: boolean }
type DeployDiffs = { diffs: import('../../shared/deployCore').RepoDiff[]; changelog: string; output: string; root: string }
type DeployEnvStatus = {
  env: 'dev' | 'qa' | 'staging' | 'prod'
  api: import('../../shared/deployCore').StatusCell & { detail: string }
  web: import('../../shared/deployCore').StatusCell & { detail: string }
}

interface Window {
  api: {
    uiLoad: (name: 'threads' | 'prefs') => Record<string, unknown>
    uiSave: (name: 'threads' | 'prefs', value: Record<string, unknown>) => void
    setTitleBar: (color: string, symbol: string) => void
    listSessions: () => Promise<SessionInfo[]>
    searchQuery: (text: string) => Promise<SearchResult>
    searchStatus: () => Promise<SearchStatus>
    onSearchProgress: (cb: (s: SearchStatus) => void) => () => void
    sessionStats: (path: string) => Promise<SessionStats>
    getStatus: () => Promise<Status>
    listDir: (dir: string) => Promise<FsEntry[]>
    gitDecorations: (dir: string, fresh?: boolean) => Promise<import('../../shared/fileDecoCore').Decorations>
    pickFolder: () => Promise<string | null>
    listHooks: (folder: string) => Promise<HookRow[]>
    setHook: (folder: string, id: string, enabled: boolean) => Promise<void>
    listPlugins: () => Promise<PluginInfo[]>
    setPlugin: (key: string, on: boolean) => Promise<void>
    listTodos: () => Promise<Todo[]>
    addTodo: (text: string, due?: string) => Promise<Todo>
    setTodoDone: (id: string, done: boolean) => Promise<void>
    setTodoStatus: (id: string, status: TodoStatus) => Promise<void>
    setTodoDue: (id: string, due: string | null) => Promise<void>
    editTodo: (id: string, text: string) => Promise<void>
    deleteTodo: (id: string) => Promise<void>
    restoreTodo: (todo: Todo, index: number) => Promise<void>
    onTodosChanged: (cb: () => void) => () => void
    readText: (path: string) => Promise<string>
    chatSend: (tabId: string, cwd: string, resume: string | undefined, msg: Outgoing) => Promise<void>
    chatDequeue: (tabId: string, queueId: string) => Promise<boolean>
    chatPromote: (tabId: string, queueId: string) => Promise<boolean>
    chatInterrupt: (tabId: string) => Promise<void>
    chatBackground: (tabId: string, toolUseId?: string) => Promise<boolean>
    chatClose: (tabId: string) => Promise<void>
    chatSetBackground: (tabId: string, on: boolean) => Promise<void>
    worktreeLinks: (thread: string) => Promise<WorktreeLink[]>
    worktreeCleanup: (thread: string) => Promise<string[]>
    pathForFile: (file: File) => string
    chatReset: () => Promise<void>
    previewUrl: (path: string) => Promise<string>
    chatMode: () => Promise<string>
    chatContext: (tabId: string) => Promise<{ total: number; max: number } | null>
    watchersList: () => Promise<import('../../shared/watchersCore').WatchersList>
    watcherDetail: (id: string) => Promise<import('../../shared/watchersCore').WatcherDetail | null>
    watcherCreate: (input: { name: string; goal: string; schedule?: unknown; cwd?: string }) => Promise<{ id: string; message: string }>
    watcherUpdate: (id: string, input: { name?: string; goal?: string; schedule?: unknown; cwd?: string }) => Promise<string>
    watcherEnable: (id: string, on: boolean) => Promise<string>
    watcherRun: (id: string, kind: 'sweep' | 'daily' | 'weekly') => Promise<string>
    watcherDelete: (id: string) => Promise<string>
    onWatchersChanged: (cb: () => void) => () => void
    settingsGet: (usage?: boolean) => Promise<import('../../shared/settingsCore').SettingsView>
    settingsValidate: (draft: import('../../shared/settingsCore').Draft) => Promise<import('../../shared/settingsCore').Problem[]>
    settingsSave: (draft: import('../../shared/settingsCore').Draft) => Promise<{ ok: boolean; problems: import('../../shared/settingsCore').Problem[]; notes: string[] }>
    homeDir: () => Promise<string>
    loadHistory: (path: string) => Promise<Item[]>
    onChatEvent: (cb: (tabId: string, event: any) => void) => () => void
    gitList: () => Promise<import('../../shared/gitCore').GitRow[]>
    gitDetail: (dir: string) => Promise<import('../../shared/gitCore').Detail>
    gitDiff: (dir: string, path: string, area: 'staged' | 'unstaged' | 'untracked', full?: boolean, orig?: string) => Promise<string>
    gitStage: (dir: string, paths: string[]) => Promise<void>
    gitUnstage: (dir: string, paths: string[]) => Promise<void>
    gitStageAll: (dir: string) => Promise<void>
    gitCommit: (dir: string, message: string) => Promise<string>
    gitBranches: (dir: string) => Promise<{ current: string | null; branches: string[] }>
    gitSwitch: (dir: string, branch: string) => Promise<string>
    gitCreateBranch: (dir: string, name: string) => Promise<string>
    gitLog: (dir: string) => Promise<import('../../shared/gitCore').Commit[]>
    gitShow: (dir: string, sha: string) => Promise<string>
    gitPush: (dir: string) => Promise<string>
    gitFetch: (dir: string) => Promise<string>
    gitLocate: (file: string) => Promise<{ dir: string; name: string; path: string } | null>
    deployConfig: () => Promise<{ config: import('../../shared/deployCore').DeployConfig | null; message: string }>
    deployDiffs: (suite: string, fetch?: boolean) => Promise<DeployDiffs>
    onThread: (cb: (t: { tabId: string; title: string; cwd: string; prompt: string; from?: { id: string; title: string }; sessionId?: string; path?: string }) => void) => () => void
    deployStatus: () => Promise<DeployEnvStatus[]>
    deployRun: (repo: string, target: 'staging' | 'prod') => Promise<{ runId: string }>
    deployRewatch: (repo: string, target: 'staging' | 'prod', sha: string) => Promise<string>
    deployWatchers: () => Promise<DeployWatcher[]>
    deployDismiss: (id: string) => Promise<void>
    onDeployOut: (cb: (runId: string, text: string) => void) => () => void
    onDeployEnd: (cb: (runId: string, code: number, message: string, sha: string, watchId: string) => void) => () => void
    onDeployWatch: (cb: (list: DeployWatcher[]) => void) => () => void
    openExternal: (path: string) => Promise<string>
    workspaceRoot: () => Promise<string | null>
    dropChoices: () => Promise<import('../../shared/dropCore').DropChoice[]>
    pullConfig: () => Promise<{ ok: boolean; message: string }>
    pullList: () => Promise<string[]>
    pullRun: (dry: boolean) => Promise<{ repo: string; result: string }[]>
    onPullRow: (cb: (row: { repo: string; result: string }) => void) => () => void
    allowStatus: () => Promise<import('../../shared/allowCore').AllowStatus>
    allowRun: () => Promise<import('../../shared/allowCore').AllowRun>
    accountSwitch: (email: string) => Promise<{ ok: boolean; output: string }>
    accountCancel: () => Promise<void>
    onAccountOutput: (cb: (t: string) => void) => () => void
    onAllowStatus: (cb: (s: import('../../shared/allowCore').AllowStatus) => void) => () => void
    scriptsConfig: () => Promise<{ scripts: import('../../shared/scriptsCore').ScriptView[]; message: string; path: string }>
    scriptsState: () => Promise<import('../../shared/scriptsCore').ScriptRun[]>
    scriptsRun: (name: string, label: string) => Promise<string>
    scriptsStop: (name: string) => Promise<void>
    clipboardEnabled: (on: boolean) => Promise<void>
    clipboardTake: (id: string) => Promise<import('../../shared/clipboardCore').ClipTake | null>
    clipboardDismiss: (id: string) => Promise<void>
    onClipboardOffer: (cb: (offer: import('../../shared/clipboardCore').ClipOffer | null) => void) => () => void
    onScriptsUpdate: (cb: (runs: import('../../shared/scriptsCore').ScriptRun[]) => void) => () => void
    devState: () => Promise<import('../../shared/devCore').DevState>
    devSnapshot: () => Promise<import('../../shared/devCore').DevState>
    devSources: (repo: string) => Promise<import('../../shared/devCore').SourceOption[]>
    devStack: (id: string, sources: Record<string, import('../../shared/devCore').Source>) => Promise<string[]>
    devStart: (name: string, source: import('../../shared/devCore').Source) => Promise<string>
    devStop: (name: string) => Promise<string>
    devStopAll: () => Promise<string[]>
    devLogs: (name: string) => Promise<string>
    onDevUpdate: (cb: (s: import('../../shared/devCore').DevState) => void) => () => void
    terminalOpen: (id: string, cwd: string, cols: number, rows: number) => Promise<{ scrollback: string; fresh: boolean; shell: string; cwd: string }>
    terminalWrite: (id: string, data: string) => Promise<void>
    terminalResize: (id: string, cols: number, rows: number) => Promise<void>
    terminalKill: (id: string) => Promise<void>
    onTerminalData: (cb: (id: string, chunk: string) => void) => () => void
    onTerminalExit: (cb: (id: string, code: number, closed: boolean) => void) => () => void
    // per-thread status: model / effort switches, the lists the session offers, stopping background work
    chatSetModel: (tabId: string, model: string) => Promise<void>
    chatSetEffort: (tabId: string, level: string) => Promise<void>
    chatCommands: (tabId?: string) => Promise<import('../../shared/composerCore').Command[]>
    chatModels: (tabId?: string) => Promise<{ value: string; displayName: string; description: string }[]>
    chatMcp: (tabId?: string) => Promise<McpServerRow[]>
    chatStopTask: (tabId: string, taskId: string) => Promise<boolean>
  }
}
