// Electron main process. The Agent SDK runs here.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, protocol, shell, Tray } from 'electron'
import { basename, dirname, join, resolve } from 'node:path'
import QRCode from 'qrcode'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import icon from '../../build/icon.png?asset'
import { background, closeAll, closeTab, contextUsage, dequeue, interrupt, liveUsage, promote, PERMISSION_MODE, recycleThreads, rewindApply, rewindPreview, runInThread, sendMessage, setBackground, startBackgroundThread, threadState, transcriptPath, type BackgroundThread, type Outgoing } from './chat'
import { busyTranscript, configureChat, liveQuery, resumeEverything, runningEverywhere, stopEverything, stoppedQueues, threadFacts, unreadOf, liveTabOf, liveThreads, messageThread, pauseTeam, resumeTeam, setWatcherStop, stopCodex, teamStates, threadTasks } from './chat'
import { getTeam, listTeams, onTeamChange, readLog, readTeamFile } from './teams'
import { cancelWakeup, initThreadWakeups, listWakeups, onWakeupsChanged, pauseWakeups, runWakeupNow, tick as wakeupsTick, wakeupsPaused } from './threadWakeups'
import { quietHours, setQuietHours } from './quietHours'
import type { PhoneAsk, QuietHours } from '../shared/phoneCore'
import { phoneTasks, phoneTeams, phoneWakeups } from '../shared/phoneCore'
import { pendingResent, resendGroups, takePending } from './pending'
import { initDesktopNotify } from './desktopNotify'
import { initMobile, mobileStatus, notifyPhone, pairPhone, unpairPhone, type PhoneItem, type PhoneThread } from './mobile'
import { registerStatusIpc } from './liveStatus'
import { threadStatusView } from './statusView'
import { cleanupThread, moveThreadLinks, threadLinks } from './threadWorktrees'
import { checkStatus, deployConfig, dismissWatcher, initDeploy, listWatchers, rewatch, startDeploy, suiteDiffs } from './deploy'
import { dependabotSummary, initDependabot, setDependabotEnabled } from './dependabot'
import { allowStatus, forgetAllowed, initAllowlist, markAllowed, runAllowlist } from './ipAllow'
import { setWatcherPosts } from './readOnly'
import { cancelSwitch, switchAccount } from './account'
import { listAccounts, otherClaudeProcesses, realAccountPaths, removeAccount, saveCurrent, switchAccount as switchProfile } from './accounts'
import { askBtw } from './btw'
import { deleteNote, listNotes, saveNote, watchNotes } from './notes'
import { editorMtime, editorRead, editorWrite, vsCodeUrl } from './editorFiles'
import { lspChange, lspClose, lspOpen, lspRequest, lspSaved, setDiagnosticsSink, stopLanguageServers } from './lsp'
import type { AllowStatus } from '../shared/allowCore'
import { watcherStopReason } from './watchers'
import { configureWatchers, createWatcher, deleteWatcher, initWatchers, listWatchersView, runWatcherNow, setWatcherEnabled, updateWatcher, watcherDetail, watcherTabFor } from './watchers'
import { gitDecorations, listDir, listFiles, searchFiles } from './files'
import { uiLoad, uiSave } from './uiStore'
import { phoneThreads, type ThreadMap } from '../shared/threadsCore'
import { CONTINUE_PROMPT } from '../shared/continueCore'
import { loadHistory, loadRecentHistory } from './history'
import { listHooks, listPlugins, setHook, setPlugin } from './hooks'
import { checkForUpdates, applyUpdate, startUpdater, updateState } from './updater'
import { latestEngine, updateEngine } from './engine'
import { handleScheme, openExternal, previewUrl, readText, registerScheme, SCHEME } from './preview'
import { configureQuarry, e2eQuarry, onQuarryChange, quarryCall, quarryStatus, stopQuarry } from './quarry'
import { confirmByCard, quarryConnections, quarryExplain, quarryQuery, quarrySchema } from './quarryTools'
import { QuarryError, uiRequest } from './quarryCore'
import { saveSearchNow, searchSessions, searchStatus, setSearchBusy, startSearch, syncSearch } from './search'
import { listSessions } from './sessions'
import { answerAsk, openAsks } from './asks'
import { cancelContinue, continueAt, continueNow, initAutoContinue, listContinues, setContinuesPaused } from './autoContinue'
import { readTodos } from './teamTodos'
import { addTodo, deleteTodo, editTodo, listTodos, restoreTodo, setDone, setDue, setStatus, watchTodos, type Todo, type TodoStatus } from './todos'
import { sessionStats } from './sessionStats'
import { checkLogin, closeStatus, getStatus, restartStatus, setLiveUsage, weeklyUsage } from './status'
import { loadConfig, readDotEnv } from './devConfig'
import { loadSettings, saveSettings, sessionFlags, SETTINGS_FILE } from './settings'
import { effectiveEnv, envForSave, isSecretKey, normalizeSettings, sectionOf, validateSettings, type Draft, type Settings, type SettingsView } from '../shared/settingsCore'
import { parseDropChoices } from '../shared/dropCore'
import { pullAll } from './pull'
import * as gitPanel from './git'
import { dismissClipboard, setClipboardEnabled, takeClipboard, watchClipboard } from './clipboard'
import { initScripts, runScript, scriptsConfig, scriptsState, stopAllScripts, stopScript } from './scripts'
import * as dev from './devStack'
import { killAllTerminals, killTerminal, openTerminal, resizeTerminal, setTerminalSink, writeTerminal } from './terminal'
import type { Source } from '../shared/devCore'
import { appName, setAppName, windowTitle } from '../shared/appName'
import { runCodex } from './codex'
import { APP_ID, NEXT, PRODUCT } from '../shared/edition'
import { blocked, dataDir, TEST_MODE } from './testMode'
import { handoffAt, handoffName } from '../shared/handoffCore'
import { isAppPage, rosterOf, teamWindowSearch } from '../shared/teamSidebarCore'
import { keyAction, phoneFolder, readyGate } from './windowCore'

// test mode: Electron's own storage (search index, sessions cache, page storage) lives in the test data folder
if (TEST_MODE) app.setPath('userData', join(dataDir(), 'userData'))
// beside Hive: its own name and its own Electron storage, so the two apps keep separate locks, caches and windows
else if (NEXT) { app.setName(PRODUCT); app.setPath('userData', join(app.getPath('appData'), PRODUCT)) }
// test mode only: what the e2e specs read straight from the main process (e2e/10-idle-close, e2e/11-live-settings).
// facts: a thread's live process (null once it has none); settings: the running Claude process's own answer to the
// get_settings control request (the SDK sends it with Query.getSettings, which its types do not list)
if (TEST_MODE) {
  (globalThis as unknown as { __hiveTest: unknown }).__hiveTest = {
    facts: (tabId: string) => threadFacts(tabId),
    settings: (tabId: string) => (liveQuery(tabId) as unknown as { getSettings?: () => Promise<unknown> } | undefined)?.getSettings?.() ?? null,
  }
}

registerScheme()

// Settings: the store (~/.claude/hive-settings.json, seeded once from the .env and scripts.json) over the .env.
// Re-read after every save from the Settings panel; the panels explain a missing config.
const APP_DIR = app.getAppPath()
const SCRIPTS_FILE = process.env.HIVE_SCRIPTS_FILE || join(APP_DIR, 'scripts.json')
let settings: Settings = loadSettings(readDotEnv(APP_DIR).env, SCRIPTS_FILE)
let appConfig = loadConfig(APP_DIR, (env) => effectiveEnv(env, settings))
// the app name and tagline (Settings > General) for the system prompt, messages and the window title
setAppName(settings.general.appName, settings.general.appTagline)
// the workspace root and its worktrees folder: threads under them share the root's auto-memory folder
function chatRoots() { return { root: appConfig.config?.root ?? '', worktrees: appConfig.config?.worktreesDir } }
dev.init(appConfig)
initDeploy(appConfig)
gitPanel.initGit(appConfig)
// Scripts: the list from the settings store (scripts.json only when the store has none); every run's state goes to the window
initScripts(APP_DIR, (runs) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('scripts:update', runs)
}, undefined, () => settings.scripts)

// The main window (threads, tabs) and the pop-out Team window. Threads always belong to the main window's page,
// never to the Team window, so every "the window" below means mainWin.
let mainWin: BrowserWindow | null = null
let teamWin: BrowserWindow | null = null
const mainWeb = () => (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isDestroyed() ? mainWin.webContents : null)
// the main window's page has loaded and has reset (chat:reset, its first effect): only then can it be handed threads
const page = readyGate()
// Hive's own background threads (Dependabot reviewers) open as background tabs in the app window
const appWindow = () => { const w = mainWeb(); return w && !w.isLoading() && page.ready() ? mainWin! : undefined }
function spawnThread(t: BackgroundThread) {
  const w = appWindow()
  if (!w) throw new Error(`The ${appName()} window is not ready`)
  startBackgroundThread(t, w.webContents)
}
// Dependabot reviewers: background threads in auto mode, like any other
const startReview = (t: BackgroundThread) => { try { spawnThread(t); return true } catch { return false } }
// review threads still working, for the cap on how many run at once
const activeReviews = () => liveThreads().filter((t) => t.tabId.startsWith('dependabot-') && t.busy).length
initDependabot(appConfig.env, appConfig.config?.root ?? '', startReview, activeReviews)
// IP allowlist button: on when the public IP changed since the configured command last succeeded
const allowChanged = (st: AllowStatus) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('allow:status', st) }
initAllowlist(appConfig.env, allowChanged)
setWatcherPosts(appConfig.env)
configureChat(appConfig.env, chatRoots())
setWatcherStop(watcherStopReason)
// search leaves a working thread's transcript until its turn ends
setSearchBusy(busyTranscript)
// usage limits: the idle status process has none, so a live thread's answer stands in
setLiveUsage(liveUsage)
// Watchers: scheduled self-prompting background threads, one long-lived thread each (folders under ~/.claude/hive/watchers);
// the old single Watch (HIVE_WATCH_* settings) moves in as watcher "watch" on the first start. Dependabot shows in the same list.
// team threads: the list, one team with its live member states, log, plan and knowledge (the Team view)
handle('teams:list', () => listTeams().map((t) => ({ id: t.id, name: t.name, goal: t.goal, createdAt: t.createdAt, endedAt: t.endedAt, members: t.members.length })))
handle('teams:view', (_e, id: string) => {
  const t = getTeam(String(id))
  return t ? { team: t, states: teamStates(t), log: readLog(t).slice(-300), plan: readTeamFile(t, 'plan.md'), knowledge: readTeamFile(t, 'knowledge.md'), todos: readTodos(t) } : null
})
handle('teams:pause', (_e, id: string) => pauseTeam(String(id), { id: 'you', title: 'You' }, 'paused from the Team view'))
// reopened threads open as tabs in the main window, also when Resume is pressed in the Team window
handle('teams:resume', (e, id: string) => resumeTeam(String(id), { id: 'you', title: 'You' }, mainWeb() ?? e.sender))
// the sidebar's Teams section: running teams, Lead first, with each person's tab id and Claude session
// every team: the sidebar shows the running ones in Teams and marks an ended team's threads in the normal lists
handle('teams:roster', () => listTeams().map(rosterOf))
handle('teams:openWindow', (_e, id?: string) => openTeamWindow(id ? String(id) : null))
// from the Team window: show a thread in the main window, or say something in it like typing in its tab
handle('teams:activate', (_e, threadId: string) => { showWindow(); mainWeb()?.send('hive:activate', String(threadId)) })
handle('teams:say', (_e, threadId: string, text: string) => {
  const w = mainWeb()
  if (!w || !liveThreads().some((t) => t.tabId === threadId)) return false
  w.send('hive:say', String(threadId), String(text))
  return true
})
onTeamChange((id) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('teams:changed', id) })

const watchersChanged = () => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('watchers:changed') }
initWatchers(appConfig.env, appConfig.config?.root ?? '', {
  runThread: (t) => { const w = appWindow(); if (!w) return false; try { runInThread(t, w.webContents); return true } catch { return false } },
  threadState, closeThread: closeTab, transcript: transcriptPath, usage: () => weeklyUsage(), changed: watchersChanged,
}, [{ id: 'dependabot', summary: dependabotSummary, setEnabled: setDependabotEnabled }])

// Threads' own scheduled wake-ups (schedule_wakeup): delivered like a message from another thread, which resumes a
// thread that is not open. A window that is not ready yet leaves them pending for the next check.
initThreadWakeups((sessionId, text) => {
  const w = appWindow()
  if (!w) return Promise.reject(new Error('window not ready'))
  return messageThread(sessionId, text, 'queue', { id: 'hive-wakeup', title: 'Scheduled wake-up' }, w.webContents)
})

// The phone app (through the relay): its requests map onto the same threads the window shows
const mobileChanged = () => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('mobile:status', mobileStatus()) }
// seen: a message of yours in the transcript is one Claude has taken in (the CLI writes it then)
const phoneItems = (items: Awaited<ReturnType<typeof loadRecentHistory>>['items']): PhoneItem[] => items.flatMap((it): PhoneItem[] => {
  if (it.kind === 'user') return [{ k: 'you', t: it.text, seen: true }]
  if (it.kind === 'assistant') return [{ k: 'claude', t: it.text }]
  if (it.kind === 'thread' || it.kind === 'agent') return [{ k: 'you', t: it.text }]
  if (it.kind === 'tool') { const i = it.input ?? {}; return [{ k: 'tool', t: `${it.name.replace(/^mcp__\w+?__/, '')} ${i.description ?? i.file_path ?? i.pattern ?? i.command ?? i.url ?? ''}`.trim().slice(0, 200) }] }
  if (it.kind === 'note' || it.kind === 'summary') return [{ k: 'note', t: it.kind === 'summary' ? 'Earlier conversation compacted' : it.text }]
  return []
}).slice(-80).map((p) => ({ ...p, t: p.t.length > 4000 ? `${p.t.slice(0, 4000)}…` : p.t })) // well under the relay's frame limit
// a message to a thread by tab or session id: a live one takes it like a window message, a closed one is resumed.
// user: typed on the phone (it passes a paused team's hold); an automatic continue is not
async function sendTo(id: string, text: string, user: boolean): Promise<string> {
  const w = appWindow()
  if (!w) throw new Error(`The ${appName()} window is not open`)
  if (text !== CONTINUE_PROMPT) cancelContinue(id) // the user wrote to it: no automatic continue
  const l = liveThreads().find((t) => t.tabId === id || t.sessionId === id)
  if (l) { runInThread({ tabId: l.tabId, cwd: l.cwd, title: l.title, prompt: text, user }, w.webContents); return 'sent' }
  const s = (await listSessions()).find((x) => x.id === id)
  if (!s) throw new Error('That thread is gone')
  // a watcher's session resumes in the watcher's own tab, so it stays read-only
  runInThread({ tabId: watcherTabFor(s.id) ?? s.id, cwd: s.cwd, title: s.title, prompt: text, resume: s.id, user }, w.webContents)
  return 'sent'
}
const mobileDeps = () => ({
  threads: async (): Promise<PhoneThread[]> => {
    // the sidebar's sections (Watchers, Pinned, Waiting, Working, Recent), from the same pins and watcher runs
    // watchers first: listing them settles a finished run and can close its tab, so the live list is read after
    const { watchers } = await listWatchersView()
    const live = liveThreads().map((t) => ({ tabId: t.tabId, sessionId: t.sessionId, title: t.title, folder: basename(t.cwd), busy: t.busy, waitingReason: t.waitingReason }))
    return phoneThreads(live, await listSessions(), watchers, uiLoad('threads') as ThreadMap, Date.now())
  },
  // the plan limits as the status bar's usage popover shows them (one cached reading, see status.ts)
  answer: (id: string, ask: string, answers: unknown) => { const l = liveThreads().find((t) => t.tabId === id || t.sessionId === id); return !!l && answerAsk(l.tabId, ask, answers) },
  usage: async () => { const st = await getStatus(); return { plan: st.plan, rows: st.usage } },
  read: async (id: string) => {
    const l = liveThreads().find((t) => t.tabId === id || t.sessionId === id)
    const saved = l ? undefined : (await listSessions()).find((s) => s.id === id)
    const path = l?.sessionId ? transcriptPath(l.cwd, l.sessionId) : saved?.path
    // tasks: the thread's running background work (a 1.x phone app ignores it)
    const tasks = l ? phoneTasks(threadTasks(l.tabId)) : []
    if (!path) return l ? { title: l.title, items: [], working: l.busy, asks: openAsks(l.tabId), tasks } : null
    const { items } = await loadRecentHistory(path)
    // a finished watcher run: say its thread is closed and what a reply costs
    const ended: PhoneItem[] = saved?.watcherRun ? [{ k: 'note', t: 'This watcher run has ended and its thread is closed. Replying reopens it: Claude reads the whole conversation again, which counts against your usage.' }] : []
    // what you wrote that Claude has not read yet (queued, or not echoed back) follows, marked not seen
    const unread: PhoneItem[] = l ? unreadOf(l.tabId).map((t) => ({ k: 'you', t: t.length > 4000 ? `${t.slice(0, 4000)}…` : t, seen: false })) : []
    return { title: l?.title ?? saved?.title ?? id, items: [...phoneItems(items), ...unread, ...ended], working: !!l?.busy, asks: l ? openAsks(l.tabId) : [], tasks }
  },
  send: (id: string, text: string) => sendTo(id, text, true),
  start: async (folder: string, text: string) => {
    const w = appWindow()
    if (!w) throw new Error(`The ${appName()} window is not open`)
    // only a folder this app offered the phone (folders below); empty = the workspace root
    const cwd = folder ? phoneFolder(folder, mobileDeps().folders()) : appConfig.config?.root || homedir()
    if (!cwd) throw new Error('That folder is not one the phone can start a thread in')
    const tabId = `phone-${Date.now()}`
    runInThread({ tabId, cwd, title: text.replace(/\s+/g, ' ').slice(0, 50), prompt: text, user: true }, w.webContents)
    return { id: tabId } // the phone opens the thread it just started
  },
  stop: async (id: string) => { const l = liveThreads().find((t) => t.tabId === id || t.sessionId === id); if (l) await interrupt(l.tabId) },
  // the folders a new thread can start in: the workspace root and the git repos directly under it
  folders: () => {
    const root = appConfig.config?.root
    if (!root) return []
    try { return [root, ...readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, '.git'))).map((d) => join(root, d.name))] } catch { return [root] }
  },
  changed: mobileChanged,
  // 2.0 screens: running teams, pause / resume (as the Team view does it), a thread's background work, wake-ups
  teams: () => phoneTeams(listTeams(), (t) => ({ states: teamStates(t), log: readLog(t), liveId: (id) => liveTabOf(t, id) })),
  teamPause: async (id: string) => {
    const t = getTeam(id)
    if (!t || t.endedAt) throw new Error('That team is not running')
    return pauseTeam(t.id, { id: 'you', title: 'You' }, 'paused from the phone')
  },
  teamResume: async (id: string) => {
    const t = getTeam(id)
    if (!t || t.endedAt) throw new Error('That team is not running')
    const w = mainWeb()
    if (!w) throw new Error(`The ${appName()} window is not open`)
    return resumeTeam(t.id, { id: 'you', title: 'You' }, w)
  },
  // only a task the thread is running now
  stopTask: async (thread: string, task: string) => {
    const l = liveThreads().find((t) => t.tabId === thread || t.sessionId === thread)
    if (!l || !threadTasks(l.tabId).some((x) => x.id === task && x.status === 'running')) return false
    if (task.startsWith('codex:')) return stopCodex(task.slice(6))
    const q = liveQuery(l.tabId)
    if (!q) return false
    await q.stopTask(task)
    return true
  },
  wakeups: () => phoneWakeups(listWakeups(), listContinues()),
  // 2.0 app: a thread now without its transcript, all running background work, stop everything, run a wake-up now,
  // and the quiet hours it shares with Hive
  peek: (id: string) => {
    const l = liveThreads().find((t) => t.tabId === id || t.sessionId === id)
    return l ? { working: l.busy, asks: openAsks(l.tabId) as PhoneAsk[] } : null
  },
  // the phone's own words: kind "Workflow", "Subagent", ... and a workflow's script name in its title (phoneTasks)
  running: () => runningEverywhere().map(({ tabId, title, task }) => ({ thread: tabId, threadTitle: title, ...phoneTasks([task])[0], state: 'working' as const })),
  stopAll: (pause: boolean) => stopAll(pause),
  runWakeNow: (kind: string, id: string) => runWakeNow(kind, id),
  quietHours: (set?: QuietHours) => (set ? setQuietHours(set) : quietHours()),
  // the saved accounts and the switch between them, as the window has them (never a token)
  accounts: () => (TEST_MODE ? [] : listAccounts(realAccountPaths()).map((a) => ({
    id: a.id, name: a.organization ?? a.email, detail: a.email, note: a.plan ?? '', inUse: a.active,
  }))),
  switchAccount: async (id: string) => {
    const r = await switchToProfile(id)
    if (!r.ok) throw new Error(r.error ?? 'The switch did not finish')
    return `Switched to ${r.account}${r.waiting ? `; ${r.waiting} thread${r.waiting > 1 ? 's' : ''} move when they finish` : ''}${r.warning ? `. ${r.warning}` : ''}`
  },
  cancelWakeup: (kind: string, id: string) => (kind === 'wake' ? /^\d+$/.test(id) && cancelWakeup(Number(id)) : kind === 'continue' ? cancelContinue(id) : false),
})
initMobile(appConfig.env, mobileDeps())
// Wake-ups and automatic continues, for the window's list: every pending one, cancel one, and a nudge on any change
const wakeupsChanged = () => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('wakeups:changed') }
onWakeupsChanged(wakeupsChanged)
// paused wake-ups hold the automatic continues too
setContinuesPaused(wakeupsPaused)
// Stop everything (the phone and the window): every working thread and background task; pause: also hold the
// wake-ups and automatic continues until they are resumed (nothing is dropped; what came due fires once on resume)
async function stopAll(pause: boolean): Promise<{ threads: number; tasks: number }> {
  const r = await stopEverything()
  if (pause) pauseWakeups(true)
  return r
}
// run one wake-up or automatic continue now
async function runWakeNow(kind: string, id: string): Promise<boolean> {
  if (kind === 'wake') return /^\d+$/.test(id) && runWakeupNow(Number(id))
  if (kind === 'continue') return continueNow(id)
  return false
}
handle('hive:stopAll', (_e, pause?: boolean) => stopAll(!!pause))
// after Stop everything: the held queues go again and paused wake-ups are resumed (what came due fires once)
handle('hive:resumeAll', () => { const queues = resumeEverything(); const wasPaused = wakeupsPaused(); if (wasPaused) pauseWakeups(false); wakeupsChanged(); return { queues, wakeups: wasPaused } })
handle('wakeups:runNow', (_e, kind: string, id: string) => runWakeNow(String(kind), String(id)))
handle('wakeups:pause', (_e, on: boolean) => { pauseWakeups(!!on); return wakeupsPaused() })
handle('quiet:get', () => quietHours())
handle('quiet:set', (_e, q: unknown) => setQuietHours(q))
handle('wakeups:list', () => ({
  paused: wakeupsPaused(),
  held: stoppedQueues(), // queues Stop everything holds
  wakeups: listWakeups().map((r) => ({ id: r.id, sessionId: r.session_id, title: r.title, wakeAt: r.wake_at, prompt: r.prompt, everyMinutes: r.every_minutes, firedAt: r.fired_at })),
  continues: listContinues(),
}))
handle('wakeups:cancel', (_e, kind: string, id: string) => {
  const k = String(kind)
  const v = String(id)
  return k === 'wake' ? /^\d+$/.test(v) && cancelWakeup(Number(v)) : k === 'continue' ? cancelContinue(v) : false
})
// threads that hit the usage limit continue by themselves after the reset (saved across restarts)
initAutoContinue({
  fire: async (w, prompt) => {
    if (!appWindow()) return false // tried again in a minute
    try { await sendTo(w.key, prompt, false) } catch (e) { console.warn(`auto-continue ${w.title}: ${(e as Error).message}`) } // a thread that is gone is dropped
    return true
  },
  // to the tab it started in and to a tab reopened under the session id (after a restart)
  changed: (w, at) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) for (const id of new Set([w.tabId, w.key])) win.webContents.send('chat:event', id, { type: 'hive_continue', at, key: w.key })
    wakeupsChanged()
  },
})

// every consumer picks up saved settings without a restart (running dev services keep theirs until restarted)
function applySettings() {
  setAppName(settings.general.appName, settings.general.appTagline)
  if (mainWin && !mainWin.isDestroyed()) mainWin.setTitle(windowTitle())
  appConfig = loadConfig(APP_DIR, (env) => effectiveEnv(env, settings))
  dev.init(appConfig)
  initDeploy(appConfig)
  gitPanel.initGit(appConfig)
  initDependabot(appConfig.env, appConfig.config?.root ?? '', startReview, activeReviews)
  configureWatchers(appConfig.config?.root ?? '', appConfig.env)
  initAllowlist(appConfig.env, allowChanged)
  setWatcherPosts(appConfig.env)
  configureChat(appConfig.env, chatRoots())
  void configureQuarry(settings.general.quarryPath)
  initMobile(appConfig.env, mobileDeps())
}
const draftOf = (d: unknown): Draft => {
  const n = normalizeSettings(d) ?? normalizeSettings({})!
  return { env: n.env, scripts: n.scripts, general: n.general }
}
// usage = also read the 7-day limit (can take a moment at start), for the Watch tier line
async function settingsView(usage = false): Promise<SettingsView> {
  const dot = readDotEnv(APP_DIR)
  const w = usage ? await weeklyUsage().catch((e) => ({ pct: null, error: (e as Error).message })) : null
  const env = Object.fromEntries(Object.entries(effectiveEnv(dot.env, settings)).filter(([k]) => !isSecretKey(k)))
  return {
    file: SETTINGS_FILE, envFile: dot.path, scriptsFile: SCRIPTS_FILE, env, scripts: settings.scripts, general: settings.general,
    sections: Object.fromEntries(Object.keys(env).map((k) => [k, sectionOf(k)])),
    secrets: Object.entries(dot.env).filter(([k]) => isSecretKey(k)).map(([k, v]) => ({ key: k, set: !!v.trim() })), // never the value
    problems: validateSettings(settings, existsSync, homedir()),
    weekly: w && { pct: w.pct, error: w.error },
  }
}
function saveFromPanel(d: unknown) {
  const draft = draftOf(d)
  const problems = validateSettings(draft, existsSync, homedir())
  if (problems.some((p) => p.level === 'error')) return { ok: false, problems, notes: [] as string[] }
  const before = settings
  const next: Settings = { version: 1, env: envForSave(draft.env, readDotEnv(APP_DIR).env), scripts: draft.scripts, general: draft.general }
  saveSettings(next)
  settings = next
  applySettings()
  const changed = (sec: string) => [...new Set([...Object.keys(before.env), ...Object.keys(next.env)])].some((k) => sectionOf(k) === sec && (before.env[k] ?? '') !== (next.env[k] ?? ''))
  const notes: string[] = []
  if (changed('dev')) notes.push('Dev stack: services already running keep their old settings until you restart them.')
  if (changed('other')) notes.push('Other keys: restart Hive for anything that reads them at start.')
  if (before.general.shell !== next.general.shell) notes.push('Terminal shell: used by terminals opened from now on.')
  if (before.general.model !== next.general.model || before.general.effort !== next.general.effort) notes.push('Model and effort: used by threads started from now on.')
  return { ok: true, problems, notes }
}

// The app's own page: the dev server in development, the built index.html otherwise.
const DEV_URL = process.env.ELECTRON_RENDERER_URL
const APP_HTML = join(__dirname, '../renderer/index.html')
// compare parsed origins / the exact file, never string prefixes ("http://localhost:5173@evil.example");
// the Team window's ?view=team&team=<id> is the same page
const isAppUrl = (url: string): boolean => isAppPage(url, DEV_URL || pathToFileURL(APP_HTML).href, !!DEV_URL)

// Every IPC call must come from the app's own top-level page, never from a preview frame
// or from a page the window was somehow navigated to.
function handle(channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (e.senderFrame !== e.sender.mainFrame || !isAppUrl(e.senderFrame?.url ?? '')) throw new Error('Not allowed')
    return fn(e, ...args)
  })
}

// thread state + UI prefs: sync load (the UI reads them while it starts), fire-and-forget save
const fromApp = (e: Electron.IpcMainEvent) => e.senderFrame === e.sender.mainFrame && isAppUrl(e.senderFrame?.url ?? '')
ipcMain.on('ui:load', (e, name: string) => { e.returnValue = fromApp(e) ? uiLoad(String(name)) : {} })
// the title bar overlay (Windows min / max / close) follows the theme
ipcMain.on('app:titlebar', (e, color: string, symbol: string) => {
  if (!fromApp(e)) return
  try { BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({ color: String(color), symbolColor: String(symbol), height: 40 }) } catch { /* not supported */ }
})
ipcMain.on('ui:save', (e, name: string, value: unknown) => { if (fromApp(e)) uiSave(String(name), value) })

handle('sessions:list', async () => { const l = await listSessions(); syncSearch(l); return l })
handle('search:query', (_e, text: string) => searchSessions(String(text)))
handle('search:status', () => searchStatus())
handle('session:stats', (_e, path: string) => sessionStats(path))
handle('status:get', (_e, force: unknown) => getStatus(force === true))
handle('fs:list', (_e, dir: string) => listDir(dir))
handle('fs:listAll', (_e, dir: string) => listFiles(String(dir)))
// Find in conversation: the window's own find, so it searches the whole window (message box and side panels too).
// The result (n of m) goes back as find:result.
const finding = new WeakSet<Electron.WebContents>()
handle('find:run', (e, text: string, forward: boolean, next: boolean) => {
  const wc = e.sender
  if (!finding.has(wc)) { finding.add(wc); wc.on('found-in-page', (_ev, r) => { if (!wc.isDestroyed()) wc.send('find:result', { active: r.activeMatchOrdinal, total: r.matches }) }) }
  if (String(text)) wc.findInPage(String(text), { forward: !!forward, findNext: !!next })
  else wc.stopFindInPage('clearSelection')
})
handle('find:stop', (e) => e.sender.stopFindInPage('clearSelection'))
handle('fs:search', (_e, dir: string, q: string) => searchFiles(String(dir), String(q)))
handle('fs:gitDeco', (_e, dir: string, fresh?: boolean) => gitDecorations(String(dir), !!fresh))
handle('hooks:list', (_e, folder: string) => listHooks(folder))
handle('hooks:set', (_e, folder: string, id: string, enabled: boolean) => setHook(folder, id, enabled))
handle('plugins:list', () => listPlugins())
handle('plugins:set', (_e, key: string, on: boolean) => setPlugin(key, on))
// Notes: markdown files in ~/.claude/hive/notes
handle('notes:list', () => listNotes())
handle('notes:save', (_e, id: string | null, text: string) => saveNote(id ? String(id) : null, String(text ?? '')))
handle('notes:delete', (_e, id: string) => deleteNote(String(id)))
watchNotes(() => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('notes:changed') })
handle('todos:list', () => listTodos())
handle('todos:add', (_e, text: string, due?: string) => addTodo(text, 'user', due ? { due } : {}))
handle('todos:done', (_e, id: string, done: boolean) => setDone(id, done))
handle('todos:status', (_e, id: string, status: TodoStatus) => setStatus(id, status))
handle('todos:due', (_e, id: string, due: string | null) => setDue(id, due))
handle('todos:edit', (_e, id: string, text: string) => editTodo(id, text))
handle('todos:delete', (_e, id: string) => deleteTodo(id))
handle('todos:restore', (_e, todo: Todo, index: number) => restoreTodo(todo, Number(index)))
// the list file changed on disk (Hive, the agent's add_todo tool, the terminal helper): tell the window to reload it
watchTodos(() => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('todos:changed')
})
handle('chat:send', (e, tabId: string, cwd: string, resume: string | undefined, msg: Outgoing) => sendMessage(tabId, cwd, resume, msg, e.sender))
// Rewind a turn: the files Claude changed since a message of yours, then the conversation back to before it
handle('chat:rewindPreview', (_e, tabId: string, cwd: string, sessionId: string, uuid: string) => rewindPreview(String(tabId), String(cwd), String(sessionId), String(uuid)))
handle('chat:rewindApply', (_e, tabId: string, cwd: string, sessionId: string, uuid: string, files: unknown) =>
  rewindApply(String(tabId), String(cwd), String(sessionId), String(uuid), Array.isArray(files) ? files.map(String) : null))
handle('chat:dequeue', (_e, tabId: string, queueId: string) => dequeue(tabId, queueId))
handle('chat:promote', (_e, tabId: string, queueId: string) => promote(tabId, queueId))
handle('chat:interrupt', (_e, tabId: string) => interrupt(tabId))
handle('chat:continueAt', (_e, id: string) => continueAt(String(id)))
handle('chat:cancelContinue', (_e, id: string) => cancelContinue(String(id)))
handle('chat:answer', (_e, tabId: string, id: string, answers: unknown) => answerAsk(String(tabId), String(id), answers))
handle('chat:background', (_e, tabId: string, toolUseId?: string) => background(tabId, toolUseId))
handle('chat:close', (_e, tabId: string) => { killTerminal(String(tabId)); return closeTab(tabId) })
// the tab moved to the background or back on screen: switch its live session's permission mode
handle('chat:setBackground', (e, tabId: string, on: boolean) => setBackground(tabId, !!on, e.sender))
// worktrees a thread made through the worktree tool; Close / Archive deletes them (plain code, result notes back)
handle('worktree:links', (_e, thread: string) => threadLinks(String(thread)))
handle('worktree:cleanup', (_e, thread: string) => cleanupThread(String(thread)))
handle('worktree:move', (_e, from: string, to: string) => moveThreadLinks(String(from), String(to)))
// the page (re)loaded: no tab is showing any live session any more, so stop them all. The main window's page is ready
// for threads from now on; messages left unsent when Hive last closed go out once, after its first reset
let resent = false
handle('chat:reset', (e) => {
  killAllTerminals()
  closeAll()
  if (e.sender !== mainWeb()) return
  page.reset()
  if (resent) return
  resent = true
  setTimeout(() => resendPending(e.sender), 1000)
})
handle('chat:mode', () => PERMISSION_MODE)
handle('chat:context', (_e, tabId: string) => contextUsage(tabId))
// Watchers: the list, one watcher's detail, and the same actions the agent tools have
handle('watchers:list', () => listWatchersView())
handle('watchers:detail', (_e, id: string) => watcherDetail(String(id)))
handle('watchers:create', (_e, input: Record<string, unknown>) => createWatcher({
  name: String(input?.name ?? ''), goal: String(input?.goal ?? ''), schedule: input?.schedule, cwd: input?.cwd ? String(input.cwd) : undefined,
}, 'user'))
handle('watchers:update', (_e, id: string, input: Record<string, unknown>) => updateWatcher(String(id), {
  ...(input?.name !== undefined ? { name: String(input.name) } : {}), ...(input?.goal !== undefined ? { goal: String(input.goal) } : {}),
  ...(input?.schedule !== undefined ? { schedule: input.schedule } : {}), ...(input?.cwd !== undefined ? { cwd: String(input.cwd) } : {}),
}))
handle('watchers:enable', (_e, id: string, on: boolean) => setWatcherEnabled(String(id), !!on))
handle('watchers:run', (_e, id: string, kind: string) => runWatcherNow(String(id), kind === 'daily' || kind === 'weekly' ? kind : 'sweep'))
handle('watchers:delete', (_e, id: string) => deleteWatcher(String(id)))
handle('settings:get', (_e, usage?: boolean) => settingsView(!!usage))
handle('settings:validate', (_e, d: unknown) => validateSettings(draftOf(d), existsSync, homedir()))
handle('settings:save', (_e, d: unknown) => saveFromPanel(d))
// per-thread status: model, effort, commands, models, MCP servers, stopping background tasks
registerStatusIpc(handle, { liveQuery, stopCodex })
// /status and /usage for one thread, live (statusView.ts): the tab's folder and session for a thread with no process yet
handle('chat:statusView', (_e, tabId: string, known?: { cwd?: string; sessionId?: string }) =>
  threadStatusView({ liveQuery, facts: threadFacts, transcript: transcriptPath, defaultAdvisor: () => sessionFlags().advisorModel ?? null }, String(tabId ?? ''), {
    ...(known?.cwd ? { cwd: String(known.cwd) } : {}), ...(known?.sessionId ? { sessionId: String(known.sessionId) } : {}),
  }))
// Deploy: reads, plus the wizard's explicit Yes (never a Claude tool)
handle('deploy:config', () => deployConfig())
handle('deploy:diffs', (_e, suite: string, fetch?: boolean) => suiteDiffs(String(suite), fetch !== false))
handle('deploy:status', () => checkStatus())
handle('deploy:run', (e, repo: string, target: 'staging' | 'prod') => startDeploy(e.sender, repo, target))
handle('deploy:rewatch', (_e, repo: string, target: 'staging' | 'prod', sha: string) => rewatch(repo, target, sha))
handle('deploy:watchers', () => listWatchers())
handle('deploy:dismiss', (_e, id: string) => dismissWatcher(id))
handle('app:home', () => app.getPath('home'))
// the workspace root from .env: the default folder for new threads and the Files panel (null without a .env)
handle('app:workspace', () => appConfig.config?.root ?? null)
// Pull latest: plain git
handle('drop:choices', () => parseDropChoices(appConfig.env.HIVE_DROP_SKILLS))
// Handoff: the size a thread is offered a fresh one at (HIVE_HANDOFF_AT), and a new file for a handoff to go in
handle('handoff:at', () => handoffAt(appConfig.env.HIVE_HANDOFF_AT))
const HANDOFFS = () => join(dataDir(), 'hive', 'handoffs')
handle('handoff:file', (_e, tabId: string) => join(HANDOFFS(), handoffName(String(tabId), Date.now())))
// written (in the handoffs folder, since the request, with something in it): only then does the fresh thread start
handle('handoff:ready', (_e, file: string, since: number) => {
  const f = resolve(String(file))
  if (dirname(f) !== resolve(HANDOFFS())) return false
  try { const st = statSync(f); return st.isFile() && st.size >= 200 && st.mtimeMs >= Number(since) - 2000 } catch { return false }
})
handle('pull:run', (_e, dry: boolean) => {
  if (!appConfig.config) throw new Error(appConfig.message)
  return pullAll(appConfig.config, !!dry) // the rows come back as the answer (nothing listens for them one by one)
})
handle('allow:status', () => allowStatus())
handle('allow:run', () => runAllowlist())
// Codex from the side bar: one `codex exec` run in a folder; its activity lines go to the page as they come
let codexProc: import('node:child_process').ChildProcess | null = null
handle('codex:run', async (e, task: unknown, folder: unknown, edits: unknown) => {
  if (TEST_MODE) return { ok: false, answer: blocked('Codex') }
  if (codexProc) return { ok: false, answer: 'Codex is already running a task.' }
  const dir = typeof folder === 'string' && folder && existsSync(folder) ? folder : appConfig.config?.root || homedir()
  const web = e.sender
  try {
    return await runCodex({ task: String(task ?? ''), folder: dir, allowEdits: edits === true, onLine: (l) => { if (!web.isDestroyed()) web.send('codex:line', l) } }, (p) => { codexProc = p })
  } finally { codexProc = null }
})
handle('codex:stop', () => { codexProc?.kill(); return true })
// forget an allowed address, so it can be allowed again (its rule expired or was removed on the other side)
handle('allow:forget', (_e, address: string) => forgetAllowed(String(address ?? '')))
handle('allow:mark', () => markAllowed())
// updates from GitHub Releases (packaged builds only)
handle('update:state', () => updateState())
handle('update:check', () => checkForUpdates())
// quitting first: otherwise closing the window only hides it to the tray and the install never runs
handle('update:apply', () => { if (updateState()?.kind === 'ready') quitting = true; applyUpdate() })
// a newer Claude Code engine (new models arrive with it) and `claude update`
handle('engine:latest', () => latestEngine())
handle('engine:update', () => updateEngine())
// Accounts. Nothing restarts when the login changes: the status process starts again on the new login, every quiet
// thread closes its process (tab and session stay; the next message resumes it on the new login) and a busy one does
// the same when its work ends. The window hears account:switched and accounts:changed.
const accountsChanged = () => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('accounts:changed') }
async function movedToNewLogin(): Promise<{ account: string | null; closed: number; waiting: number }> {
  restartStatus()
  const { closed, waiting } = recycleThreads()
  const account = await getStatus().then((st) => st.account).catch(() => null)
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('account:switched', { account, closed, waiting })
  accountsChanged()
  return { account, closed, waiting }
}
const keepProfile = () => { if (!TEST_MODE) { try { saveCurrent(realAccountPaths()) } catch (e) { console.warn('accounts: could not save the current login:', (e as Error).message) } } }
// Add account: the engine's browser sign-in; the login before it and the new one are both kept as profiles
handle('account:switch', async (e, email: string) => {
  keepProfile() // the account signed in now keeps its newest tokens
  const r = await switchAccount(String(email ?? ''), (t) => { if (!e.sender.isDestroyed()) e.sender.send('account:output', t) })
  if (!r.ok) return r
  keepProfile()
  await movedToNewLogin()
  return r
})
// the saved accounts: id, email, plan, when saved and last used, and which one is signed in (never a token)
handle('accounts:list', () => (TEST_MODE ? [] : listAccounts(realAccountPaths())))
// switch to a saved account without the browser; a login that no longer works says so (sign in again with Add account)
type ProfileSwitch = { ok: boolean; account: string | null; closed: number; waiting: number; warning?: string; needsSignIn?: boolean; error?: string }
async function switchToProfile(id: string): Promise<ProfileSwitch> {
  if (TEST_MODE) return { ok: false, account: null, closed: 0, waiting: 0, error: blocked('switching the Claude account') }
  const others = await otherClaudeProcesses().catch(() => 0)
  const warning = others ? `${others} other Claude session${others > 1 ? 's are' : ' is'} running (a terminal or an IDE): ${others > 1 ? 'they keep' : 'it keeps'} the old login until restarted, and may write it back. Close ${others > 1 ? 'them' : 'it'} for a clean switch.` : undefined
  let done
  try { done = switchProfile(realAccountPaths(), String(id)) } catch (e) {
    return { ok: false, account: null, closed: 0, waiting: 0, ...(warning ? { warning } : {}), error: (e as Error).message }
  }
  if (!done.changed) return { ok: true, account: done.account.email, closed: 0, waiting: 0, ...(warning ? { warning } : {}) }
  const moved = await movedToNewLogin()
  const login = await checkLogin()
  return {
    ok: login.ok, account: done.account.email, closed: moved.closed, waiting: moved.waiting, ...(warning ? { warning } : {}),
    ...(login.ok ? {} : { needsSignIn: true, error: `The saved login for ${done.account.email} no longer works (${login.error}). Sign in to it again with Add account.` }),
  }
}
handle('accounts:switch', (_e, id: string) => switchToProfile(String(id ?? '')))
// forget a saved account (its profile only; the engine's own login is left as it is)
handle('accounts:remove', (_e, id: string) => { const ok = !TEST_MODE && removeAccount(realAccountPaths(), String(id ?? '')); if (ok) accountsChanged(); return ok })
handle('account:cancel', () => cancelSwitch())
// Git panel: plain git on the repos and worktrees Hive lists; the page names a folder from that list, never a command
handle('git:list', () => gitPanel.gitList())
handle('git:detail', (_e, dir: string) => gitPanel.gitDetail(String(dir)))
handle('git:diff', (_e, dir: string, path: string, area: string, full?: boolean, orig?: string) =>
  gitPanel.gitDiff(String(dir), String(path), area === 'staged' || area === 'untracked' ? area : 'unstaged', !!full, orig ? String(orig) : undefined))
handle('git:stage', (_e, dir: string, paths: string[]) => gitPanel.gitStage(String(dir), paths))
handle('git:unstage', (_e, dir: string, paths: string[]) => gitPanel.gitUnstage(String(dir), paths))
handle('git:stageAll', (_e, dir: string) => gitPanel.gitStageAll(String(dir)))
handle('git:commit', (_e, dir: string, message: string) => gitPanel.gitCommit(String(dir), String(message)))
handle('git:branches', (_e, dir: string) => gitPanel.gitBranches(String(dir)))
handle('git:switch', (_e, dir: string, branch: string) => gitPanel.gitSwitch(String(dir), String(branch)))
handle('git:createBranch', (_e, dir: string, name: string) => gitPanel.gitCreateBranch(String(dir), String(name)))
handle('git:log', (_e, dir: string) => gitPanel.gitLog(String(dir)))
handle('git:show', (_e, dir: string, sha: string) => gitPanel.gitShow(String(dir), String(sha)))
handle('git:push', (_e, dir: string) => gitPanel.gitPush(String(dir)))
handle('git:fetch', (_e, dir: string) => gitPanel.gitFetch(String(dir)))
handle('git:locate', (_e, file: string) => gitPanel.gitLocate(String(file)))
// Scripts: plain commands from scripts.json; the page names a script and an option, never a command
handle('scripts:config', () => scriptsConfig())
handle('scripts:state', () => scriptsState())
handle('scripts:run', (_e, name: string, label: string) => runScript(String(name), String(label)))
handle('scripts:stop', (_e, name: string) => stopScript(String(name)))
// Dev stack: plain code; the buttons run as the user
handle('dev:state', () => dev.status())
handle('dev:snapshot', () => dev.snapshot())
handle('dev:sources', (_e, repo: string) => dev.sources(repo))
handle('dev:stack', (_e, id: string, srcs: Record<string, Source>, only?: string[]) => dev.startStack(id, srcs ?? {}, dev.USER, Array.isArray(only) ? only : undefined, true))
handle('dev:start', (_e, name: string, src: Source) => dev.startService(name, src, dev.USER))
handle('dev:stop', (_e, name: string) => dev.stopService(name, dev.USER))
handle('dev:logs', (_e, name: string) => dev.logs(name, 1000))
handle('history:load', (_e, path: string) => loadHistory(path))
// /btw: a side question about a thread, answered by a throwaway fork (nothing goes into the thread)
handle('chat:btw', (_e, cwd: string, sessionId: string | null, question: string) => askBtw(String(cwd ?? ''), sessionId ? String(sessionId) : null, String(question)))
// a reopened thread: its recent end first (more = there is earlier conversation to load)
handle('history:recent', (_e, path: string) => loadRecentHistory(path))
handle('fs:readText', (_e, path: string) => readText(path))
// The editor: files, and the language servers (Pyright, TypeScript, Vue) its open files talk to
// the phone app: pairing shows a QR code (made here, so the key never goes through the page as text it could log)
// Quit from the app's own menu (the window's × only hides it to the tray)
handle('app:quit', () => { quitting = true; app.quit() })
handle('mobile:status', () => mobileStatus())
handle('mobile:pair', async () => { const { qr } = await pairPhone(); return { image: await QRCode.toDataURL(qr, { margin: 1, width: 320, errorCorrectionLevel: 'M' }) } })
handle('mobile:unpair', () => unpairPhone())
handle('mobile:test', () => notifyPhone(`Test from ${appName()}`, 'Notifications reach this phone.'))
handle('editor:read', (_e, path: string) => editorRead(String(path)))
handle('editor:mtime', (_e, path: string) => editorMtime(String(path)))
handle('editor:write', (_e, path: string, text: string, expected?: number | null) => editorWrite(String(path), String(text), typeof expected === 'number' ? expected : null))
handle('editor:vscode', (_e, path: string, line: number) => shell.openExternal(vsCodeUrl(String(path), Number(line) || 1)))
handle('lsp:open', (_e, file: string, text: string) => lspOpen(String(file), String(text)))
handle('lsp:change', (_e, file: string, text: string, version: number) => lspChange(String(file), String(text), Number(version)))
handle('lsp:saved', (_e, file: string) => lspSaved(String(file)))
handle('lsp:close', (_e, file: string) => lspClose(String(file)))
handle('lsp:request', (_e, file: string, method: string, params: unknown) => lspRequest(String(file), String(method), params))
setDiagnosticsSink((d) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('lsp:diagnostics', d) })
handle('preview:url', (_e, path: string) => previewUrl(path))
handle('shell:open', (_e, path: string) => openExternal(path))
// Clipboard suggestions: the page's switch, the click that takes the item, the x that dismisses it
handle('clipboard:enabled', (_e, on: boolean) => setClipboardEnabled(!!on))
handle('clipboard:take', (_e, id: string) => takeClipboard(String(id)))
handle('clipboard:dismiss', (_e, id: string) => dismissClipboard(String(id)))
// Terminal drawer: the person's own shell under each tab (the agent has its own Bash tool, not this)
setTerminalSink({
  data: (id, chunk) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('terminal:data', id, chunk) },
  exit: (id, code, closed) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('terminal:exit', id, code, closed) },
})
handle('terminal:open', (_e, id: string, cwd: string, cols: number, rows: number) => openTerminal(String(id), String(cwd ?? ''), cols, rows))
handle('terminal:write', (_e, id: string, data: string) => writeTerminal(String(id), String(data)))
handle('terminal:resize', (_e, id: string, cols: number, rows: number) => resizeTerminal(String(id), cols, rows))
handle('dialog:folder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

// save a conversation's Markdown where the user picks; false when they cancel
handle('dialog:saveMarkdown', async (e, name: string, text: string) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const safe = String(name).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'conversation'
  const r = await dialog.showSaveDialog(win, { defaultPath: `${safe}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (r.canceled || !r.filePath) return false
  writeFileSync(r.filePath, String(text), 'utf8')
  return true
})

// web links open in the browser
const openInBrowser = (url: string) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url) }

// a window only ever shows the app; links go to the browser, preview frames stay on local previews
function guardWindow(web: Electron.WebContents): void {
  web.on('will-navigate', (e, url) => { if (!isAppUrl(url)) { e.preventDefault(); openInBrowser(url) } })
  web.on('will-redirect', (e, url) => { if (!isAppUrl(url)) e.preventDefault() })
  web.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && !e.url.startsWith(`${SCHEME}:`) && !e.url.startsWith('about:')) e.preventDefault()
  })
  web.setWindowOpenHandler(({ url }) => { openInBrowser(url); return { action: 'deny' } })
}

// The Team window: the Team view alone, full size, outside the main window. One at a time: opening it again focuses
// it (and switches to the team asked for). Closing it closes it for real; Quit closes it too.
function openTeamWindow(teamId: string | null): void {
  const name = teamId ? getTeam(teamId)?.name : undefined
  const title = name ? `${name}, Team` : 'Team'
  if (teamWin && !teamWin.isDestroyed()) {
    if (teamId) { teamWin.setTitle(title); teamWin.webContents.send('teams:pick', teamId) }
    if (teamWin.isMinimized()) teamWin.restore()
    teamWin.show()
    teamWin.focus()
    return
  }
  const win = new BrowserWindow({
    title, width: 1500, height: 900, backgroundColor: '#1f1f1f', icon, autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })
  teamWin = win
  win.on('closed', () => { if (teamWin === win) teamWin = null })
  win.on('page-title-updated', (e) => e.preventDefault()) // keep "<team>, Team", not the page's own title
  guardWindow(win.webContents)
  const search = teamWindowSearch(teamId)
  if (DEV_URL) { const u = new URL(DEV_URL); u.search = search; void win.loadURL(u.href) }
  else void win.loadFile(APP_HTML, { search })
}

// messages that had not reached Claude when Hive last closed go to their threads again (chat:reset, once)
function resendPending(web: Electron.WebContents): void {
  for (const p of TEST_MODE ? [] : resendGroups(takePending())) {
    // the original tab id: a watcher's thread stays a watcher's thread (and read-only)
    // under one uuid, so the CLI's echo of it clears these messages from the pending file
    const uuid = randomUUID()
    pendingResent(p.keys, uuid)
    try { runInThread({ tabId: p.tabId, cwd: p.cwd, title: p.title, prompt: p.prompt, foreground: p.background === false, user: true, uuid, ...(p.sessionId ? { resume: p.sessionId } : {}) }, web) } catch (e) { console.error('pending message not resent:', e) }
  }
}

// ---- Quarry (quarry.ts): its UI in a <webview> on the Quarry page, its agent interface as thread tools ----
// The page's view is the only thing that may call Quarry's UI methods (quarry:invoke): these are the user's own
// actions, as in the Quarry window. Every other caller gets "Not allowed".
const QUARRY_UI = 'quarry://app/'
const QUARRY_PRELOAD = () => join(__dirname, '../preload/quarry.js')
const quarryViews = new Set<number>()
const quarryChanged = () => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('quarry:changed', quarryStatus()) }
onQuarryChange(quarryChanged)
// the UI's own calls run as long as the user's query does (Quarry has its own statement timeout and Cancel)
const UI_CALL_MS = 60 * 60_000
const apiErrorOf = (e: unknown) => (e instanceof QuarryError && e.data ? e.data : { code: 'internal', message: (e as Error)?.message ?? String(e), sqlstate: null, detail: null, hint: null, position: null })
ipcMain.handle('quarry:invoke', (e, method: string, params: unknown) => {
  if (!quarryViews.has(e.sender.id) || !e.sender.getURL().startsWith(QUARRY_UI)) throw new Error('Not allowed')
  return quarryCall(String(method), params && typeof params === 'object' ? params : {}, UI_CALL_MS).then((value) => ({ ok: true, value }), (err) => ({ ok: false, error: apiErrorOf(err) }))
})
ipcMain.handle('quarry:saveFile', async (e, name: string) => {
  if (!quarryViews.has(e.sender.id) || !mainWin) throw new Error('Not allowed')
  // the opt-in e2e with a real Quarry cannot click a native dialog: the file goes in the run's own folder
  if (e2eQuarry()) { const dir = join(dataDir(), 'quarry-export'); mkdirSync(dir, { recursive: true }); return join(dir, basename(String(name || 'export.csv')).replace(/[^\w.-]+/g, '_')) }
  const r = await dialog.showSaveDialog(mainWin, { defaultPath: String(name || 'export.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] })
  return r.canceled || !r.filePath ? null : r.filePath
})
handle('quarry:status', () => quarryStatus())
// Only in the opt-in e2e with a real Quarry (test mode, HIVE_E2E_QUARRY=1, HIVE_QUARRY_EXE): the thread tools' own
// handlers run against it without a Claude turn; a write's question card goes to the tab named, as in a real thread
if (e2eQuarry()) {
  handle('quarry:e2eTool', (e, tabId: string, toolName: string, args: Record<string, unknown>) => {
    const a = (args ?? {}) as { connection: string; sql: string; schema?: string; table?: string; allow_write?: boolean; analyze?: boolean }
    const emit = (ev: unknown) => { if (!e.sender.isDestroyed()) e.sender.send('chat:event', String(tabId), ev) }
    if (toolName === 'quarry_connections') return quarryConnections()
    if (toolName === 'quarry_schema') return quarrySchema(a)
    if (toolName === 'quarry_explain') return quarryExplain(a)
    if (toolName === 'quarry_query') return quarryQuery(a, confirmByCard(String(tabId), emit, new AbortController().signal))
    throw new Error(`no tool ${toolName}`)
  })
}
// quarry://app/...: the UI's files, from the serve process (ui.index, ui.asset); anything else is not found
function handleQuarryScheme(): void {
  protocol.handle('quarry', async (req) => {
    const r = uiRequest(req.url)
    if (!r || !quarryStatus().available) return new Response('Not found', { status: 404 })
    try {
      const a = await quarryCall<{ mime: string; base64: string }>(r.method, r.method === 'ui.asset' ? { path: r.path } : undefined, 30_000)
      return new Response(Buffer.from(a.base64, 'base64'), { headers: { 'content-type': a.mime } })
    } catch { return new Response('Not found', { status: 404 }) }
  })
}
// a <webview> in the app's page: only the Quarry UI, with the Quarry preload and nothing else; it never navigates away
function guardWebviews(web: Electron.WebContents): void {
  web.on('will-attach-webview', (e, prefs, params) => {
    if (!String(params.src ?? '').startsWith(QUARRY_UI) || !quarryStatus().available) { e.preventDefault(); return }
    delete (prefs as { preloadURL?: string }).preloadURL
    prefs.preload = QUARRY_PRELOAD()
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
  })
  web.on('did-attach-webview', (_e, wc) => {
    quarryViews.add(wc.id)
    wc.on('destroyed', () => quarryViews.delete(wc.id))
    wc.on('will-navigate', (ev, url) => { if (!url.startsWith(QUARRY_UI)) { ev.preventDefault(); openInBrowser(url) } })
    wc.setWindowOpenHandler(({ url }) => { openInBrowser(url); return { action: 'deny' } })
  })
}

function createWindow(): void {
  // test mode with HIVE_TEST_OFFSCREEN=1: the window is drawn off the screen and never takes the focus, so a test or a
  // screenshot run does not land on top of someone's work
  const offscreen = TEST_MODE && process.env.HIVE_TEST_OFFSCREEN === '1'
  const win = new BrowserWindow({
    ...(offscreen ? { show: false, x: -32000, y: -32000, skipTaskbar: true } : {}),
    title: windowTitle(),
    width: 1400,
    height: 900,
    backgroundColor: '#1f1f1f',
    icon, // window and taskbar icon (the installed app also gets it from the exe)
    // our own top bar in the UI; Windows keeps only min / max / close
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#171A1D', symbolColor: '#CBD1D7', height: 40 },
    // plugins: Chromium's built-in PDF viewer for the Preview panel
    // webviewTag: the Quarry page's view only (guardWebviews: its source, preload and settings are fixed in main)
    webPreferences: { preload: join(__dirname, '../preload/index.js'), plugins: true, webviewTag: true },
  })
  mainWin = win
  win.on('closed', () => { if (mainWin === win) mainWin = null })
  if (offscreen) win.showInactive()
  const web = win.webContents
  watchClipboard(win)
  // the window only ever shows the app; links in chat replies go to the browser instead
  guardWindow(web)
  guardWebviews(web)
  // the app menu is removed (own top bar), which also removed its shortcuts: dev tools, Quit, and reload only in dev
  // Text size, the way a code editor does it: Ctrl+= larger, Ctrl+- smaller, Ctrl+0 back to the usual size. The whole
  // window scales (text, icons, spacing) and the size is kept for the next start.
  const zoomFile = join(dataDir(), 'hive-zoom.json')
  const DEFAULT_ZOOM = 0.5
  let zoom = DEFAULT_ZOOM
  try { const z = Number(JSON.parse(readFileSync(zoomFile, 'utf8')).level); if (Number.isFinite(z)) zoom = Math.max(-2, Math.min(4, z)) } catch { /* the usual size */ }
  const setZoom = (z: number) => {
    zoom = Math.max(-2, Math.min(4, Math.round(z * 2) / 2))
    web.setZoomLevel(zoom)
    try { mkdirSync(dataDir(), { recursive: true }); writeFileSync(zoomFile, JSON.stringify({ level: zoom })) } catch { /* kept for this run only */ }
  }
  web.on('did-finish-load', () => web.setZoomLevel(zoom))
  web.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && !input.alt && !input.shift) {
      const step = input.key === '=' || input.key === '+' ? 0.5 : input.key === '-' ? -0.5 : input.key === '0' ? 0 : null
      if (step !== null) { e.preventDefault(); setZoom(step === 0 ? DEFAULT_ZOOM : zoom + step); return }
    }
    const act = keyAction(input, !!DEV_URL)
    if (!act) return
    e.preventDefault()
    if (act === 'reload') web.reload()
    else if (act === 'devtools') web.toggleDevTools()
    else { quitting = true; app.quit() } // Quit (the × only hides to the tray)
  })
  // a page that loads again (a dev reload, a crash) is not ready for threads until it has reset
  web.on('did-start-loading', () => page.loading())

  // closing the window hides it to the tray (like Slack or Teams): threads, watchers and the phone link keep running.
  // Quit is in the tray menu. Test mode closes for real, so the tests can end the app.
  win.on('close', (e) => { if (!quitting && !TEST_MODE) { e.preventDefault(); win.hide() } })

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(APP_HTML)

  // Run from source while it is being rebuilt: a new build of the page (npm run build) shows by itself. Never while a
  // thread has a live process, because a reloaded page stops it: then Ctrl+R (or F5) loads the build when you choose.
  if (NEXT && !DEV_URL && !app.isPackaged && !TEST_MODE) {
    let timer: NodeJS.Timeout | null = null
    try {
      const w = watch(join(__dirname, '../renderer'), { recursive: true }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          if (win.isDestroyed() || !existsSync(APP_HTML)) return
          if (liveThreads().length) void web.executeJavaScript("window.dispatchEvent(new CustomEvent('hive:build'))").catch(() => {})
          else web.reload()
        }, 900)
      })
      win.on('closed', () => w.close())
    } catch { /* no watch: Ctrl+R still loads a new build */ }
  }
}

let quitting = false
let tray: Tray | null = null
const showWindow = () => {
  const w = mainWin && !mainWin.isDestroyed() ? mainWin : null
  if (!w) { createWindow(); return }
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}
function makeTray(): void {
  if (TEST_MODE || tray) return
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  tray.setToolTip(appName())
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${appName()}`, click: showWindow },
    { type: 'separator' },
    { label: `Quit ${appName()}`, click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', showWindow)
}
app.on('before-quit', () => { quitting = true; saveSearchNow(); stopQuarry() })

// one Hive at a time: opening it again (the shortcut, Start menu) brings back the running one
if (!TEST_MODE && !app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', showWindow)

// Run from source on Windows the process is electron.exe, so the taskbar shows Electron's icon and name. Windows takes
// both from a Start menu shortcut that carries the same app id, so one is kept there: the taskbar
// button then shows Hive's icon, and pinning it starts this checkout. Not in tests.
function sourceRunIdentity(): void {
  if (process.platform !== 'win32' || TEST_MODE || !process.env.APPDATA) return
  const id = `${APP_ID}.source`
  try {
    const programs = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    const root = app.getAppPath()
    const options = { target: process.execPath, args: `"${root}"`, cwd: root, icon: join(root, 'build', 'icon.ico'), iconIndex: 0, appUserModelId: id, description: PRODUCT }
    // a "Hive" shortcut that already starts this Electron (made by hand, also the one in Startup) is the one to keep;
    // otherwise a "Hive (source)" one is made, so an installed Hive's own shortcut is never touched
    const mine = (f: string) => { try { return shell.readShortcutLink(f).target.toLowerCase() === process.execPath.toLowerCase() } catch { return false } }
    const own = [join(programs, `${PRODUCT}.lnk`), join(programs, 'Startup', `${PRODUCT}.lnk`), join(app.getPath('desktop'), `${PRODUCT}.lnk`)].filter(mine)
    for (const f of own) shell.writeShortcutLink(f, 'update', options)
    const link = join(programs, `${PRODUCT} (source).lnk`)
    if (!own.length) shell.writeShortcutLink(link, existsSync(link) ? 'update' : 'create', options)
    app.setAppUserModelId(id)
  } catch { /* the taskbar keeps Electron's icon */ }
}

Menu.setApplicationMenu(null)
app.whenReady().then(() => {
  // the laptop slept through wake-ups: fire them once it is back (after the network has had a moment)
  powerMonitor.on('resume', () => { setTimeout(() => void wakeupsTick(), 15_000) })
  // Windows toasts need it; same as appId in electron-builder.yml.
  if (app.isPackaged) app.setAppUserModelId(APP_ID)
  else sourceRunIdentity()
  initDesktopNotify(() => mainWin, (id) => { showWindow(); if (id) mainWeb()?.send('hive:activate', id) })
  // the account signed in now is kept as a profile (its newest tokens), so it can be switched back to later
  keepProfile()
  handleScheme()
  handleQuarryScheme()
  void configureQuarry(settings.general.quarryPath)
  createWindow()
  makeTray()
  startSearch()
  startUpdater((st) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('update:state', st) })
})
app.on('window-all-closed', () => {
  saveSearchNow()
  stopQuarry()
  closeStatus()
  stopLanguageServers()
  closeAll()
  stopAllScripts()
  killAllTerminals()
  app.quit()
})
