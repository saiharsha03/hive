// Bridge between the UI and the main process.
import { contextBridge, ipcRenderer, webUtils } from 'electron'

type DeployWatcher = { id: string; state: 'working' | 'waiting'; note: string; stuck: boolean; landed: boolean }

contextBridge.exposeInMainWorld('api', {
  uiLoad: (name: string) => ipcRenderer.sendSync('ui:load', name),
  setTitleBar: (color: string, symbol: string) => ipcRenderer.send('app:titlebar', color, symbol),
  uiSave: (name: string, value: unknown) => ipcRenderer.send('ui:save', name, value),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  searchQuery: (text: string) => ipcRenderer.invoke('search:query', text),
  searchStatus: () => ipcRenderer.invoke('search:status'),
  onSearchProgress: (cb: (s: unknown) => void) => {
    const fn = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('search:progress', fn)
    return () => ipcRenderer.removeListener('search:progress', fn)
  },
  sessionStats: (path: string) => ipcRenderer.invoke('session:stats', path),
  getStatus: () => ipcRenderer.invoke('status:get'),
  listDir: (dir: string) => ipcRenderer.invoke('fs:list', dir),
  gitDecorations: (dir: string, fresh?: boolean) => ipcRenderer.invoke('fs:gitDeco', dir, fresh),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  saveMarkdown: (name: string, text: string) => ipcRenderer.invoke('dialog:saveMarkdown', name, text),
  listHooks: (folder: string) => ipcRenderer.invoke('hooks:list', folder),
  setHook: (folder: string, id: string, enabled: boolean) => ipcRenderer.invoke('hooks:set', folder, id, enabled),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  setPlugin: (key: string, on: boolean) => ipcRenderer.invoke('plugins:set', key, on),
  editorRead: (path: string) => ipcRenderer.invoke('editor:read', path),
  editorMtime: (path: string) => ipcRenderer.invoke('editor:mtime', path),
  editorWrite: (path: string, text: string) => ipcRenderer.invoke('editor:write', path, text),
  openInVsCode: (path: string, line: number) => ipcRenderer.invoke('editor:vscode', path, line),
  lspOpen: (file: string, text: string) => ipcRenderer.invoke('lsp:open', file, text),
  lspChange: (file: string, text: string, version: number) => ipcRenderer.invoke('lsp:change', file, text, version),
  lspSaved: (file: string) => ipcRenderer.invoke('lsp:saved', file),
  lspClose: (file: string) => ipcRenderer.invoke('lsp:close', file),
  lspRequest: (file: string, method: string, params: unknown) => ipcRenderer.invoke('lsp:request', file, method, params),
  onLspDiagnostics: (cb: (d: { uri: string; diagnostics: unknown[] }) => void) => {
    const fn = (_e: unknown, d: { uri: string; diagnostics: unknown[] }) => cb(d)
    ipcRenderer.on('lsp:diagnostics', fn)
    return () => ipcRenderer.removeListener('lsp:diagnostics', fn)
  },
  quitApp: () => ipcRenderer.invoke('app:quit'),
  mobileStatus: () => ipcRenderer.invoke('mobile:status'),
  mobilePair: () => ipcRenderer.invoke('mobile:pair'),
  mobileUnpair: () => ipcRenderer.invoke('mobile:unpair'),
  mobileTest: () => ipcRenderer.invoke('mobile:test'),
  onMobileStatus: (cb: (s: unknown) => void) => {
    const fn = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('mobile:status', fn)
    return () => ipcRenderer.removeListener('mobile:status', fn)
  },
  listNotes: () => ipcRenderer.invoke('notes:list'),
  saveNote: (id: string | null, text: string) => ipcRenderer.invoke('notes:save', id, text),
  deleteNote: (id: string) => ipcRenderer.invoke('notes:delete', id),
  onNotesChanged: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('notes:changed', fn)
    return () => ipcRenderer.removeListener('notes:changed', fn)
  },
  listTodos: () => ipcRenderer.invoke('todos:list'),
  addTodo: (text: string, due?: string) => ipcRenderer.invoke('todos:add', text, due),
  setTodoDone: (id: string, done: boolean) => ipcRenderer.invoke('todos:done', id, done),
  setTodoStatus: (id: string, status: string) => ipcRenderer.invoke('todos:status', id, status),
  setTodoDue: (id: string, due: string | null) => ipcRenderer.invoke('todos:due', id, due),
  editTodo: (id: string, text: string) => ipcRenderer.invoke('todos:edit', id, text),
  deleteTodo: (id: string) => ipcRenderer.invoke('todos:delete', id),
  restoreTodo: (todo: unknown, index: number) => ipcRenderer.invoke('todos:restore', todo, index),
  onTodosChanged: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('todos:changed', fn)
    return () => ipcRenderer.removeListener('todos:changed', fn)
  },
  readText: (path: string) => ipcRenderer.invoke('fs:readText', path),
  chatSend: (tabId: string, cwd: string, resume: string | undefined, msg: unknown) => ipcRenderer.invoke('chat:send', tabId, cwd, resume, msg),
  chatRewindPreview: (tabId: string, cwd: string, sessionId: string, uuid: string) => ipcRenderer.invoke('chat:rewindPreview', tabId, cwd, sessionId, uuid),
  // files: the paths the preview listed, or null for the conversation only
  chatRewindApply: (tabId: string, cwd: string, sessionId: string, uuid: string, files: string[] | null) => ipcRenderer.invoke('chat:rewindApply', tabId, cwd, sessionId, uuid, files),
  chatDequeue: (tabId: string, queueId: string) => ipcRenderer.invoke('chat:dequeue', tabId, queueId),
  chatPromote: (tabId: string, queueId: string) => ipcRenderer.invoke('chat:promote', tabId, queueId),
  chatInterrupt: (tabId: string) => ipcRenderer.invoke('chat:interrupt', tabId),
  chatContinueAt: (id: string): Promise<number | null> => ipcRenderer.invoke('chat:continueAt', id),
  chatCancelContinue: (id: string): Promise<boolean> => ipcRenderer.invoke('chat:cancelContinue', id),
  chatAnswer: (tabId: string, id: string, answers: Record<string, string>): Promise<boolean> => ipcRenderer.invoke('chat:answer', tabId, id, answers),
  chatBackground: (tabId: string, toolUseId?: string) => ipcRenderer.invoke('chat:background', tabId, toolUseId),
  chatClose: (tabId: string) => ipcRenderer.invoke('chat:close', tabId),
  chatSetBackground: (tabId: string, on: boolean) => ipcRenderer.invoke('chat:setBackground', tabId, on),
  worktreeLinks: (thread: string) => ipcRenderer.invoke('worktree:links', thread),
  worktreeCleanup: (thread: string) => ipcRenderer.invoke('worktree:cleanup', thread),
  worktreeMove: (from: string, to: string) => ipcRenderer.invoke('worktree:move', from, to),
  // a dropped file's absolute path (File.path is gone from Electron)
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  chatReset: () => ipcRenderer.invoke('chat:reset'),
  previewUrl: (path: string) => ipcRenderer.invoke('preview:url', path),
  chatMode: () => ipcRenderer.invoke('chat:mode'),
  chatContext: (tabId: string) => ipcRenderer.invoke('chat:context', tabId),
  watchersList: () => ipcRenderer.invoke('watchers:list'),
  watcherDetail: (id: string) => ipcRenderer.invoke('watchers:detail', id),
  watcherCreate: (input: unknown) => ipcRenderer.invoke('watchers:create', input),
  watcherUpdate: (id: string, input: unknown) => ipcRenderer.invoke('watchers:update', id, input),
  watcherEnable: (id: string, on: boolean) => ipcRenderer.invoke('watchers:enable', id, on),
  watcherRun: (id: string, kind: string) => ipcRenderer.invoke('watchers:run', id, kind),
  watcherDelete: (id: string) => ipcRenderer.invoke('watchers:delete', id),
  teamsList: () => ipcRenderer.invoke('teams:list'),
  teamView: (id: string) => ipcRenderer.invoke('teams:view', id),
  teamPause: (id: string) => ipcRenderer.invoke('teams:pause', id),
  teamResume: (id: string) => ipcRenderer.invoke('teams:resume', id),
  teamRoster: () => ipcRenderer.invoke('teams:roster'),
  teamOpenWindow: (id?: string) => ipcRenderer.invoke('teams:openWindow', id),
  teamActivate: (threadId: string) => ipcRenderer.invoke('teams:activate', threadId),
  teamSay: (threadId: string, text: string) => ipcRenderer.invoke('teams:say', threadId, text),
  // the Team window: open on another team
  onTeamPick: (cb: (id: string) => void) => {
    const fn = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('teams:pick', fn)
    return () => ipcRenderer.removeListener('teams:pick', fn)
  },
  // the main window, asked by the Team window: show a thread / say something in it
  onActivateThread: (cb: (threadId: string) => void) => {
    const fn = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('hive:activate', fn)
    return () => ipcRenderer.removeListener('hive:activate', fn)
  },
  onSay: (cb: (threadId: string, text: string) => void) => {
    const fn = (_e: unknown, id: string, text: string) => cb(id, text)
    ipcRenderer.on('hive:say', fn)
    return () => ipcRenderer.removeListener('hive:say', fn)
  },
  onTeamsChanged: (cb: (id: string) => void) => {
    const fn = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('teams:changed', fn)
    return () => ipcRenderer.removeListener('teams:changed', fn)
  },
  onWatchersChanged: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('watchers:changed', fn)
    return () => ipcRenderer.removeListener('watchers:changed', fn)
  },
  settingsGet: (usage?: boolean) => ipcRenderer.invoke('settings:get', !!usage),
  settingsValidate: (draft: unknown) => ipcRenderer.invoke('settings:validate', draft),
  settingsSave: (draft: unknown) => ipcRenderer.invoke('settings:save', draft),
  homeDir: () => ipcRenderer.invoke('app:home'),
  loadHistory: (path: string) => ipcRenderer.invoke('history:load', path),
  askBtw: (cwd: string, sessionId: string | null, question: string) => ipcRenderer.invoke('chat:btw', cwd, sessionId, question),
  loadRecentHistory: (path: string) => ipcRenderer.invoke('history:recent', path),
  // every event from every live session: (tabId, event)
  onChatEvent: (cb: (tabId: string, event: any) => void) => {
    const fn = (_e: unknown, tabId: string, event: any) => cb(tabId, event)
    ipcRenderer.on('chat:event', fn)
    return () => ipcRenderer.removeListener('chat:event', fn)
  },
  gitList: () => ipcRenderer.invoke('git:list'),
  gitDetail: (dir: string) => ipcRenderer.invoke('git:detail', dir),
  gitDiff: (dir: string, path: string, area: string, full?: boolean, orig?: string) => ipcRenderer.invoke('git:diff', dir, path, area, full, orig),
  gitStage: (dir: string, paths: string[]) => ipcRenderer.invoke('git:stage', dir, paths),
  gitUnstage: (dir: string, paths: string[]) => ipcRenderer.invoke('git:unstage', dir, paths),
  gitStageAll: (dir: string) => ipcRenderer.invoke('git:stageAll', dir),
  gitCommit: (dir: string, message: string) => ipcRenderer.invoke('git:commit', dir, message),
  gitBranches: (dir: string) => ipcRenderer.invoke('git:branches', dir),
  gitSwitch: (dir: string, branch: string) => ipcRenderer.invoke('git:switch', dir, branch),
  gitCreateBranch: (dir: string, name: string) => ipcRenderer.invoke('git:createBranch', dir, name),
  gitLog: (dir: string) => ipcRenderer.invoke('git:log', dir),
  gitShow: (dir: string, sha: string) => ipcRenderer.invoke('git:show', dir, sha),
  gitPush: (dir: string) => ipcRenderer.invoke('git:push', dir),
  gitFetch: (dir: string) => ipcRenderer.invoke('git:fetch', dir),
  gitLocate: (file: string) => ipcRenderer.invoke('git:locate', file),
  deployConfig: () => ipcRenderer.invoke('deploy:config'),
  deployDiffs: (suite: string, fetch?: boolean) => ipcRenderer.invoke('deploy:diffs', suite, fetch),
  // a background thread Hive started by itself (Dependabot reviewer)
  onThread: (cb: (t: { tabId: string; title: string; cwd: string; prompt: string; foreground?: boolean }) => void) => {
    const fn = (_e: unknown, t: { tabId: string; title: string; cwd: string; prompt: string }) => cb(t)
    ipcRenderer.on('hive:thread', fn)
    return () => ipcRenderer.removeListener('hive:thread', fn)
  },
  deployStatus: () => ipcRenderer.invoke('deploy:status'),
  deployRun: (repo: string, target: string) => ipcRenderer.invoke('deploy:run', repo, target),
  deployRewatch: (repo: string, target: string, sha: string) => ipcRenderer.invoke('deploy:rewatch', repo, target, sha),
  deployWatchers: () => ipcRenderer.invoke('deploy:watchers'),
  deployDismiss: (id: string) => ipcRenderer.invoke('deploy:dismiss', id),
  onDeployOut: (cb: (runId: string, text: string) => void) => {
    const fn = (_e: unknown, runId: string, text: string) => cb(runId, text)
    ipcRenderer.on('deploy:out', fn)
    return () => ipcRenderer.removeListener('deploy:out', fn)
  },
  onDeployEnd: (cb: (runId: string, code: number, message: string, sha: string, watchId: string) => void) => {
    const fn = (_e: unknown, runId: string, code: number, message: string, sha: string, watchId: string) => cb(runId, code, message, sha, watchId)
    ipcRenderer.on('deploy:end', fn)
    return () => ipcRenderer.removeListener('deploy:end', fn)
  },
  onDeployWatch: (cb: (list: DeployWatcher[]) => void) => {
    const fn = (_e: unknown, list: DeployWatcher[]) => cb(list)
    ipcRenderer.on('deploy:watch', fn)
    return () => ipcRenderer.removeListener('deploy:watch', fn)
  },
  openExternal: (path: string) => ipcRenderer.invoke('shell:open', path),
  workspaceRoot: () => ipcRenderer.invoke('app:workspace'),
  dropChoices: () => ipcRenderer.invoke('drop:choices'),
  handoffAt: () => ipcRenderer.invoke('handoff:at'),
  handoffFile: (tabId: string) => ipcRenderer.invoke('handoff:file', tabId),
  handoffReady: (file: string, since: number) => ipcRenderer.invoke('handoff:ready', file, since),
  pullConfig: () => ipcRenderer.invoke('pull:config'),
  pullList: () => ipcRenderer.invoke('pull:list'),
  pullRun: (dry: boolean) => ipcRenderer.invoke('pull:run', dry),
  onPullRow: (cb: (row: { repo: string; result: string }) => void) => {
    const fn = (_e: unknown, row: { repo: string; result: string }) => cb(row)
    ipcRenderer.on('pull:row', fn)
    return () => ipcRenderer.removeListener('pull:row', fn)
  },
  allowStatus: () => ipcRenderer.invoke('allow:status'),
  allowRun: () => ipcRenderer.invoke('allow:run'),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateApply: () => ipcRenderer.invoke('update:apply'),
  engineLatest: () => ipcRenderer.invoke('engine:latest'),
  engineUpdate: () => ipcRenderer.invoke('engine:update'),
  onUpdateState: (cb: (s: unknown) => void) => {
    const fn = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('update:state', fn)
    return () => ipcRenderer.removeListener('update:state', fn)
  },
  accountSwitch: (email: string) => ipcRenderer.invoke('account:switch', email),
  accountCancel: () => ipcRenderer.invoke('account:cancel'),
  onAccountOutput: (cb: (t: string) => void) => {
    const fn = (_e: unknown, t: string) => cb(t)
    ipcRenderer.on('account:output', fn)
    return () => ipcRenderer.removeListener('account:output', fn)
  },
  onAllowStatus: (cb: (s: unknown) => void) => {
    const fn = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('allow:status', fn)
    return () => ipcRenderer.removeListener('allow:status', fn)
  },
  scriptsConfig: () => ipcRenderer.invoke('scripts:config'),
  scriptsState: () => ipcRenderer.invoke('scripts:state'),
  scriptsRun: (name: string, label: string) => ipcRenderer.invoke('scripts:run', name, label),
  scriptsStop: (name: string) => ipcRenderer.invoke('scripts:stop', name),
  onScriptsUpdate: (cb: (runs: unknown) => void) => {
    const fn = (_e: unknown, runs: unknown) => cb(runs)
    ipcRenderer.on('scripts:update', fn)
    return () => ipcRenderer.removeListener('scripts:update', fn)
  },
  clipboardEnabled: (on: boolean) => ipcRenderer.invoke('clipboard:enabled', on),
  clipboardTake: (id: string) => ipcRenderer.invoke('clipboard:take', id),
  clipboardDismiss: (id: string) => ipcRenderer.invoke('clipboard:dismiss', id),
  onClipboardOffer: (cb: (offer: unknown) => void) => {
    const fn = (_e: unknown, offer: unknown) => cb(offer)
    ipcRenderer.on('clipboard:offer', fn)
    return () => ipcRenderer.removeListener('clipboard:offer', fn)
  },
  devState: () => ipcRenderer.invoke('dev:state'),
  devSnapshot: () => ipcRenderer.invoke('dev:snapshot'),
  devSources: (repo: string) => ipcRenderer.invoke('dev:sources', repo),
  devStack: (id: string, sources: Record<string, unknown>, only?: string[]) => ipcRenderer.invoke('dev:stack', id, sources, only),
  devStart: (name: string, source: unknown) => ipcRenderer.invoke('dev:start', name, source),
  devStop: (name: string) => ipcRenderer.invoke('dev:stop', name),
  devStopAll: () => ipcRenderer.invoke('dev:stopAll'),
  devLogs: (name: string) => ipcRenderer.invoke('dev:logs', name),
  onDevUpdate: (cb: (s: unknown) => void) => {
    const fn = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('dev:update', fn)
    return () => ipcRenderer.removeListener('dev:update', fn)
  },
  // terminal drawer: one shell per tab
  terminalOpen: (id: string, cwd: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:open', id, cwd, cols, rows),
  terminalWrite: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
  terminalResize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  terminalKill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
  onTerminalData: (cb: (id: string, chunk: string) => void) => {
    const fn = (_e: unknown, id: string, chunk: string) => cb(id, chunk)
    ipcRenderer.on('terminal:data', fn)
    return () => ipcRenderer.removeListener('terminal:data', fn)
  },
  onTerminalExit: (cb: (id: string, code: number, closed: boolean) => void) => {
    const fn = (_e: unknown, id: string, code: number, closed: boolean) => cb(id, code, closed)
    ipcRenderer.on('terminal:exit', fn)
    return () => ipcRenderer.removeListener('terminal:exit', fn)
  },
  // per-thread status (liveStatus.ts)
  chatSetModel: (tabId: string, model: string) => ipcRenderer.invoke('chat:setModel', tabId, model),
  chatSetEffort: (tabId: string, level: string) => ipcRenderer.invoke('chat:setEffort', tabId, level),
  chatCommands: (tabId?: string) => ipcRenderer.invoke('chat:commands', tabId),
  chatModels: (tabId?: string) => ipcRenderer.invoke('chat:models', tabId),
  chatMcp: (tabId?: string) => ipcRenderer.invoke('chat:mcp', tabId),
  chatStopTask: (tabId: string, taskId: string) => ipcRenderer.invoke('chat:stopTask', tabId, taskId),
})
