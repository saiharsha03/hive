/// <reference types="vite/client" />

type SessionInfo = { id: string; title: string; project: string; cwd: string; updated: number; started: number; path: string; watcherRun?: boolean; dependabot?: boolean }

type SearchResult = { indexing: { indexed: number; total: number } | null; results: { sessionId: string; score: number; snippet: string }[] }
type SearchStatus = { indexed: number; total: number; done: boolean }

type Limit = { pct: number | null; resetsAt: string | null } | null
type Status = {
  account: string | null
  plan: string | null
  five: Limit
  seven: Limit
  usage?: { key: string; label: string; pct: number; resetsAt: string | null }[]
  usageAt?: number | null
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
  // failed: the message never reached Claude (why)
  | { kind: 'user'; text: string; images: string[]; at?: number; uuid?: string; seen?: boolean; seenAt?: number; steer?: boolean; interrupt?: boolean; during?: string; queue?: { id: string; pending: boolean }; failed?: string }
  | { kind: 'assistant'; text: string; at?: number }
  // patch: Claude Code's structuredPatch from an Edit / MultiEdit / Write result, for the diff; output: the result as text, shown when the row is opened
  | { kind: 'tool'; id: string; name: string; input: any; status: 'running' | 'done' | 'error'; patch?: unknown; output?: string }
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
type RewindFiles = { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number; skippedLinks?: number }
type McpServerRow = { name: string; status: string; source: string; error?: string; tools: number | null }
type Outgoing = { uuid?: string; title?: string; text: string; images: { mediaType: string; data: string }[]; mode?: 'steer' | 'queue'; queueId?: string; background?: boolean; interrupt?: boolean }
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

type DeployWatcher = { id: string; repo: string; sha: string; state: 'working' | 'waiting'; note: string; stuck: boolean; landed: boolean; log?: string }
type DeployDiffs = { diffs: import('../../shared/deployCore').RepoDiff[]; changelog: string; output: string; root: string }
type DeployEnvStatus = {
  env: 'dev' | 'qa' | 'staging' | 'prod'
  api: import('../../shared/deployCore').StatusCell & { detail: string }
  web: import('../../shared/deployCore').StatusCell & { detail: string }
}

declare const __APP_VERSION__: string

interface Window {
  api: {
    testMode?: boolean
    uiLoad: (name: 'threads' | 'prefs' | 'restore') => Record<string, unknown>
    uiSave: (name: 'threads' | 'prefs' | 'restore', value: Record<string, unknown>) => void
    setTitleBar: (color: string, symbol: string) => void
    listSessions: () => Promise<SessionInfo[]>
    searchQuery: (text: string) => Promise<SearchResult>
    searchStatus: () => Promise<SearchStatus>
    onSearchProgress: (cb: (s: SearchStatus) => void) => () => void
    sessionStats: (path: string) => Promise<SessionStats>
    getStatus: () => Promise<Status>
    listDir: (dir: string) => Promise<FsEntry[]>
    listAllFiles: (dir: string) => Promise<string[]>
    searchFiles: (dir: string, q: string) => Promise<string[]>
    gitDecorations: (dir: string, fresh?: boolean) => Promise<import('../../shared/fileDecoCore').Decorations>
    pickFolder: () => Promise<string | null>
    saveMarkdown: (name: string, text: string) => Promise<boolean>
    listHooks: (folder: string) => Promise<HookRow[]>
    setHook: (folder: string, id: string, enabled: boolean) => Promise<void>
    listPlugins: () => Promise<PluginInfo[]>
    setPlugin: (key: string, on: boolean) => Promise<void>
    editorRead: (path: string) => Promise<{ text: string; mtime: number }>
    editorMtime: (path: string) => Promise<number | null>
    editorWrite: (path: string, text: string, expected?: number | null) => Promise<number>
    openInVsCode: (path: string, line: number) => Promise<void>
    lspOpen: (file: string, text: string) => Promise<boolean>
    lspChange: (file: string, text: string, version: number) => Promise<void>
    lspSaved: (file: string) => Promise<void>
    lspClose: (file: string) => Promise<void>
    lspRequest: (file: string, method: string, params: unknown) => Promise<any>
    onLspDiagnostics: (cb: (d: { uri: string; diagnostics: any[] }) => void) => () => void
    quitApp: () => Promise<void>
    mobileStatus: () => Promise<{ configured: boolean; paired: boolean; connected: boolean; error: string }>
    mobilePair: () => Promise<{ image: string }>
    mobileUnpair: () => Promise<void>
    mobileTest: () => Promise<string>
    onMobileStatus: (cb: (s: { configured: boolean; paired: boolean; connected: boolean; error: string }) => void) => () => void
    listNotes: () => Promise<import('../../shared/notesCore').NoteInfo[]>
    saveNote: (id: string | null, text: string) => Promise<string>
    deleteNote: (id: string) => Promise<void>
    findRun: (text: string, forward: boolean, next: boolean) => Promise<void>
    findStop: () => Promise<void>
    onFindResult: (cb: (r: { active: number; total: number }) => void) => () => void
    onNotesChanged: (cb: () => void) => () => void
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
    chatRewindPreview: (tabId: string, cwd: string, sessionId: string, uuid: string) => Promise<RewindFiles>
    chatRewindApply: (tabId: string, cwd: string, sessionId: string, uuid: string, files: string[] | null) => Promise<{ ok: boolean; error?: string; partial?: { missing: string[]; skipped: number } }>
    chatDequeue: (tabId: string, queueId: string) => Promise<boolean>
    chatPromote: (tabId: string, queueId: string) => Promise<boolean>
    chatInterrupt: (tabId: string) => Promise<void>
    chatContinueAt: (id: string) => Promise<number | null>
    chatCancelContinue: (id: string) => Promise<boolean>
    chatAnswer: (tabId: string, id: string, answers: Record<string, string>) => Promise<boolean>
    chatBackground: (tabId: string, toolUseId?: string) => Promise<boolean>
    chatClose: (tabId: string) => Promise<void>
    chatSetBackground: (tabId: string, on: boolean) => Promise<void>
    worktreeLinks: (thread: string) => Promise<WorktreeLink[]>
    worktreeCleanup: (thread: string) => Promise<string[]>
    worktreeMove: (from: string, to: string) => Promise<number>
    pathForFile: (file: File) => string
    chatReset: () => Promise<void>
    previewUrl: (path: string) => Promise<string>
    chatMode: () => Promise<string>
    chatContext: (tabId: string) => Promise<{ total: number; max: number } | null>
    watchersList: () => Promise<import('../../shared/watchersCore').WatchersList>
    teamsList: () => Promise<{ id: string; name: string; goal: string; createdAt: number; endedAt?: number; members: number }[]>
    teamView: (id: string) => Promise<import('../../shared/teamCore').TeamView | null>
    teamPause: (id: string) => Promise<string>
    teamResume: (id: string) => Promise<string>
    teamRoster: () => Promise<import('../../shared/teamSidebarCore').Roster[]>
    teamOpenWindow: (id?: string) => Promise<void>
    teamActivate: (threadId: string) => Promise<void>
    teamSay: (threadId: string, text: string) => Promise<boolean>
    onTeamPick: (cb: (id: string) => void) => () => void
    onActivateThread: (cb: (threadId: string) => void) => () => void
    onSay: (cb: (threadId: string, text: string) => void) => () => void
    onTeamsChanged: (cb: (id: string) => void) => () => void
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
    askBtw: (cwd: string, sessionId: string | null, question: string) => Promise<string>
    loadRecentHistory: (path: string) => Promise<{ items: Item[]; more: boolean }>
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
    onThread: (cb: (t: { tabId: string; title: string; cwd: string; prompt: string; foreground?: boolean; from?: { id: string; title: string }; sessionId?: string; path?: string; queueId?: string }) => void) => () => void
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
    handoffAt: () => Promise<number>
    handoffFile: (tabId: string) => Promise<string>
    handoffReady: (file: string, since: number) => Promise<boolean>
    pullRun: (dry: boolean) => Promise<{ repo: string; result: string }[]>
    allowStatus: () => Promise<import('../../shared/allowCore').AllowStatus>
    allowForget: (address: string) => Promise<import('../../shared/allowCore').AllowStatus>
    allowRun: () => Promise<import('../../shared/allowCore').AllowRun>
    updateState: () => Promise<import('../../shared/versionCore').UpdateState | null>
    updateCheck: () => Promise<void>
    updateApply: () => Promise<void>
    engineLatest: () => Promise<string | null>
    engineUpdate: () => Promise<{ ok: boolean; output: string }>
    onUpdateState: (cb: (s: import('../../shared/versionCore').UpdateState) => void) => () => void
    accountSwitch: (email: string) => Promise<{ ok: boolean; output: string }>
    accountCancel: () => Promise<void>
    onAccountOutput: (cb: (t: string) => void) => () => void
    onAccountSwitched: (cb: (s: { account: string | null; closed: number; waiting: number }) => void) => () => void
    accountsList: () => Promise<{ id: string; email: string; organization: string | null; plan: string | null; savedAt: number; lastUsed: number | null; active: boolean }[]>
    accountsSwitch: (id: string) => Promise<{ ok: boolean; account: string | null; closed: number; waiting: number; warning?: string; needsSignIn?: boolean; error?: string }>
    accountsRemove: (id: string) => Promise<boolean>
    onAccountsChanged: (cb: () => void) => () => void
    wakeupsList: () => Promise<{
      paused: boolean
      held: number
      wakeups: { id: number; sessionId: string; title: string; wakeAt: string; prompt: string; everyMinutes: number | null; firedAt: string | null }[]
      continues: { key: string; tabId: string; title: string; at: number }[]
    }>
    wakeupsCancel: (kind: 'wake' | 'continue', id: string | number) => Promise<boolean>
    wakeupsRunNow: (kind: 'wake' | 'continue', id: string | number) => Promise<boolean>
    wakeupsPause: (on: boolean) => Promise<boolean>
    stopAll: (pause?: boolean) => Promise<{ threads: number; tasks: number }>
    resumeAll: () => Promise<{ queues: number; wakeups: boolean }>
    quietGet: () => Promise<{ on: boolean; from: string; to: string }>
    quietSet: (q: { on: boolean; from: string; to: string }) => Promise<{ on: boolean; from: string; to: string }>
    onWakeupsChanged: (cb: () => void) => () => void
    chatStatusView: (tabId: string, known?: { cwd?: string; sessionId?: string }) => Promise<import('../../main/statusView').ThreadStatusView>
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
    devStack: (id: string, sources: Record<string, import('../../shared/devCore').Source>, only?: string[]) => Promise<string[]>
    devStart: (name: string, source: import('../../shared/devCore').Source) => Promise<string>
    devStop: (name: string) => Promise<string>
    devLogs: (name: string) => Promise<string>
    onDevUpdate: (cb: (s: import('../../shared/devCore').DevState) => void) => () => void
    terminalOpen: (id: string, cwd: string, cols: number, rows: number) => Promise<{ scrollback: string; fresh: boolean; shell: string; cwd: string }>
    terminalWrite: (id: string, data: string) => Promise<void>
    terminalResize: (id: string, cols: number, rows: number) => Promise<void>
    onTerminalData: (cb: (id: string, chunk: string) => void) => () => void
    onTerminalExit: (cb: (id: string, code: number, closed: boolean) => void) => () => void
    // per-thread status: model / effort switches, the lists the session offers, stopping background work
    chatSetModel: (tabId: string, model: string) => Promise<void>
    chatSetEffort: (tabId: string, level: string) => Promise<void>
    quarryStatus: () => Promise<{ available: boolean; exe: string | null; version: string | null; running: boolean; reason: string }>
    onQuarryChanged: (cb: (s: { available: boolean; exe: string | null; version: string | null; running: boolean; reason: string }) => void) => () => void
    chatSetAdvisor: (tabId: string, model: string) => Promise<void>
    chatCommands: (tabId?: string) => Promise<import('../../shared/composerCore').Command[]>
    chatModels: (tabId?: string) => Promise<{ value: string; displayName: string; description: string }[]>
    chatMcp: (tabId?: string) => Promise<McpServerRow[]>
    chatStopTask: (tabId: string, taskId: string) => Promise<boolean>
  }
}
