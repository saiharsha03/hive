// What the window does with threads: open, show, send, close, background, reopen, stop. Plain functions over the
// stores (store.ts), so any region calls them without the shell passing callbacks down. engine.ts feeds the stores
// from main's events; nothing here keeps state of its own beyond small stores the shell draws (toasts, preview).
import { activateSession, findSession, liveRows, type LiveRow } from './background'
import { PAGE_LABEL, workingOn, type Session, type ToolTab } from './chat'
import { activate as activateIn, addPaneFor, focusedTab, moveTab, reconcile, splitWith, type PaneState } from './panes'
import { createStore, getSessions, panes, setSessions } from './store'
import { clearSnooze, keepVisible } from './threads'
import { draftEmpty, prefillDraft, type Attachment } from './SessionView'
import { fileOfTab, fileTabId, openInEditor, releaseFile } from './EditorView'
import { forgetStatus, getAllStatus } from './statusStore'
import { forgetSent } from './RunPanels'
import type { DiffSpec } from './DiffPanel'
import { resumeEverything as resumeEverythingMain, stopEverythingMain } from './api/next'
import { getAppearance, setLayout } from './appearance'

// ---- where new threads start: the workspace root, else the home folder ----
export const place = createStore<{ workspace: string; folder: string }>({ workspace: '', folder: '' })

// ---- toasts (bottom right) and the status line's 5-second Undo ----
export type Notice = { id: number; text: string }
export const notices = createStore<Notice[]>([])
export function notice(...texts: string[]) {
  const added = texts.map((text, i) => ({ id: Date.now() + i + Math.random(), text }))
  notices.set((n) => [...n, ...added])
  // a toast closes itself: 8 s, or 20 s when it reports a failure (still dismissable at once)
  for (const a of added) setTimeout(() => notices.set((all) => all.filter((x) => x.id !== a.id)), /could not|failed|error/i.test(a.text) ? 20_000 : 8_000)
}
export const dismissNotice = (id: number) => notices.set((all) => all.filter((x) => x.id !== id))
export type Undo = { text: string; run: () => void; until: number }
export const undo = createStore<Undo | null>(null)
export function offerUndo(text: string, run: () => void) {
  const u = { text, run, until: Date.now() + 5000 }
  undo.set(u)
  setTimeout(() => undo.set((cur) => (cur === u ? null : cur)), 5000)
}
export function runUndo() {
  const u = undo.get()
  if (!u) return false
  undo.set(null)
  u.run()
  return true
}

// ---- the full-window preview (a pasted image with no file behind it); files open as editor tabs ----
export const preview = createStore<string | null>(null)
export function setPreview(p: string | null) {
  if (p && !p.startsWith('data:')) { openInEditor(p); return }
  preview.set(p)
}

// ---- the diff tab: the change last picked (an edit row, a changed file) ----
export const diffSpec = createStore<DiffSpec | null>(null)
export function showDiff(d: DiffSpec | null) {
  diffSpec.set(d)
  if (d) openPage('diff')
}
// from a page that must stay in view (Workspace > Git: the commit message, Commit and Push sit there), the diff opens beside it
export function showDiffBeside(d: DiffSpec | null) {
  diffSpec.set(d)
  if (!d) return
  const id = 'tool:diff'
  // what the page's pane shows now (adding the diff's tab may land it in this pane first)
  const shown = panes.get().panes.find((x) => x.id === panes.get().focus)?.active ?? null
  if (!getSessions().some((s) => s.id === id)) setSessions((all) => [...all, { id, tool: 'diff', title: PAGE_LABEL.diff, items: [], streaming: '', busy: false, loaded: true, background: false }])
  // the page keeps the focus throughout, so it stays in view and its commit message keeps its place
  panes.set((p) => {
    const holder = p.panes.find((x) => x.tabs.includes(id))
    if (holder && holder.id !== p.focus) return holder.active === id ? p : { ...p, panes: p.panes.map((x) => (x.id === holder.id ? { ...x, active: id } : x)) }
    // not open, or open behind the page itself: take it out of this pane and open it in a pane beside
    const rest = holder ? { ...p, panes: p.panes.map((x) => { if (x.id !== holder.id) return x; const tabs = x.tabs.filter((t) => t !== id); return { ...x, tabs, active: x.active === id ? (shown && tabs.includes(shown) ? shown : tabs.at(-1) ?? null) : x.active } }) } : p
    const added = addPaneFor(rest, id, p.focus)
    return added ? { ...added, focus: p.focus } : activateIn(p, id)
  })
}

// ---- inspector: which tab it shows (Activity, Changes, Files, Status) ----
export type InspectorTab = 'activity' | 'changes' | 'files' | 'status' | 'gate' | 'rewind'
export const inspectorTab = createStore<InspectorTab>('activity')
export function showInspector(t: InspectorTab) { inspectorTab.set(t); setLayout({ inspector: true, focus: false }) }

// ---- drawer: terminal tabs and stack logs ----
export const drawer = createStore<{ tab: 'terminal' | 'stacks'; termTab: string | null; focusN: number; stack: string | null }>({ tab: 'terminal', termTab: null, focusN: 0, stack: null })
export function openTerminal(tab?: string) {
  drawer.set((d) => ({ ...d, tab: 'terminal', termTab: tab ?? d.termTab, focusN: d.focusN + 1 }))
  setLayout({ drawer: true })
}
export function openStackLog(name: string) {
  drawer.set((d) => ({ ...d, tab: 'stacks', stack: name }))
  setLayout({ drawer: true })
}
export function toggleTerminal() {
  const d = drawer.get()
  if (getAppearance().layout.drawer && d.tab === 'terminal') setLayout({ drawer: false })
  else openTerminal(activeId() ?? undefined)
}

// ---- live rows (Needs you / Working): threads plus the deploy wizard's and the scripts' rows ----
export type Live = { waiting: LiveRow[]; working: LiveRow[] }
export const live = createStore<Live>({ waiting: [], working: [] })
let extraRows: LiveRow[] = []
export function setExtraRows(rows: LiveRow[]) { extraRows = rows; recomputeLive() }
let liveKey = ''
export function recomputeLive() {
  const statuses = getAllStatus()
  const agents = new Map([...statuses].map(([tab, st]) => [tab, st.tasks.filter((t) => t.status === 'running' && t.kind !== 'local_bash').length]))
  const next = liveRows(getSessions(), extraRows, agents)
  const key = JSON.stringify(next)
  if (key !== liveKey) { liveKey = key; live.set(next) }
}

// ---- panes ----
export const activeId = (): string | null => focusedTab(panes.get())
// the thread last focused (a page or a file may be focused now)
let lastThread: string | null = null
export const setLastThread = (id: string) => { lastThread = id }
export const lastThreadId = (): string | null => (lastThread && getSessions().some((s) => s.id === lastThread) ? lastThread : null)
const visibleNow = () => getSessions().filter((s) => !s.background).map((s) => s.id)
export const setPanes = (f: (p: PaneState) => PaneState) => panes.set(f)
export { visibleNow }

// ---- threads ----
export function makeSession(title?: string): Session {
  const { workspace, folder } = place.get()
  return {
    id: `new-${Date.now()}`, title: title ?? `New thread ${getSessions().filter((s) => s.id.startsWith('new-')).length + 1}`, cwd: workspace || folder,
    items: [], streaming: '', busy: false, loaded: true, background: false,
  }
}
export function newSession(): string {
  const s = makeSession()
  setSessions((all) => [...all, s])
  panes.set((p) => activateIn(p, s.id))
  return s.id
}
// a new thread in a new pane beside `beside` (up to four)
export function newBeside(beside = panes.get().focus): string {
  const s = makeSession()
  setSessions((all) => [...all, s])
  panes.set((p) => addPaneFor(p, s.id, beside) ?? activateIn(p, s.id))
  return s.id
}

// show a session (bringing a backgrounded one back) and clear its waiting
export function activate(id: string) {
  if (id === 'deploy') { openPage('deploys'); return }
  if (id.startsWith('script:')) { openPage('workspace'); return }
  setSessions((all) => activateSession(all, id))
  panes.set((p) => activateIn(p, id))
}

// a thread in a new pane beside the focused one (Space on a rail row); a background one comes back first
export function openBeside(id: string) {
  setSessions((all) => activateSession(all, id))
  panes.set((p) => {
    const base = activateIn(reconcile(p, visibleNow().concat(id)), id)
    return splitWith(base, id, p.focus) ?? moveTab(base, id, p.focus)
  })
}

// a page opens as a tab (one tab per page)
export function openPage(page: ToolTab) {
  const id = `tool:${page}`
  setSessions((all) => (all.some((s) => s.id === id) ? all : [...all, {
    id, tool: page, title: PAGE_LABEL[page], items: [], streaming: '', busy: false, loaded: true, background: false,
  }]))
  panes.set((p) => activateIn(p, id))
}
// a page beside the focused pane (so it sits next to a thread)
export function openPageBeside(page: ToolTab) {
  const id = `tool:${page}`
  if (getSessions().some((s) => s.id === id)) { activate(id); return }
  setSessions((all) => [...all, { id, tool: page, title: PAGE_LABEL[page], items: [], streaming: '', busy: false, loaded: true, background: false }])
  panes.set((p) => addPaneFor(p, id, p.focus) ?? activateIn(p, id))
}

// a file opens as a tab next to the threads, in the focused pane (one tab per file)
export function openFileTab(path: string) {
  const id = fileTabId(path)
  setSessions((all) => (all.some((s) => s.id === id) ? all : [...all, {
    id, file: path, title: path.split(/[\\/]/).pop() ?? path, cwd: path.replace(/[\\/][^\\/]*$/, ''), items: [], streaming: '', busy: false, loaded: true, background: false,
  }]))
  panes.set((p) => activateIn(p, id))
}

const withLinks = (id: string, links: WorktreeLink[]) => setSessions((all) => all.map((s) => (s.id === id ? { ...s, worktrees: links.map(({ repo, path, branch }) => ({ repo, path, branch })) } : s)))

// reopen a past session as a tab, with its conversation; the next message resumes it. One already live is reused.
function replaceUntouched() {
  const cur = getSessions().find((s) => s.id === activeId())
  if (cur && cur.id.startsWith('new-') && !cur.items.length && !cur.busy && draftEmpty(cur.id)) setSessions((all) => all.filter((s) => s.id !== cur.id))
}
export function openSession(info: SessionInfo, opts: { beside?: boolean } = {}) {
  keepVisible(info.id) // a thread open as a tab is not a closed one: opening it brings it back to the list
  const liveOne = findSession(getSessions(), info.id)
  if (liveOne) {
    if (opts.beside) { setSessions((all) => activateSession(all, liveOne.id)); panes.set((p) => addPaneFor(p, liveOne.id, p.focus) ?? activateIn(p, liveOne.id)) }
    return activate(liveOne.id)
  }
  if (!opts.beside) replaceUntouched()
  setSessions((all) => [...all, {
    id: info.id, title: info.title, path: info.path, cwd: info.cwd, sessionId: info.id,
    items: [], streaming: '', busy: false, loaded: false, background: false, ...(info.watcherRun ? { endedRun: true } : {}),
  }])
  panes.set((p) => (opts.beside ? addPaneFor(p, info.id, p.focus) ?? activateIn(p, info.id) : activateIn(p, info.id)))
  window.api.worktreeLinks(info.id).then((links) => { if (links.length) withLinks(info.id, links) }).catch(() => {})
  window.api.loadRecentHistory(info.path).then(({ items, more }) =>
    setSessions((all) => all.map((s) => (s.id === info.id ? { ...s, items: [...items, ...s.items], loaded: true, history: { count: items.length, more } } : s)))).catch(() =>
    setSessions((all) => all.map((s) => (s.id === info.id ? { ...s, loaded: true } : s))))
}

// the rest of a long thread's transcript, on request: the full history replaces the recent part, live items stay
export function loadEarlier(id: string) {
  const s = getSessions().find((x) => x.id === id)
  if (!s?.path || !s.history?.more) return
  void window.api.loadHistory(s.path).then((items) => setSessions((all) => all.map((x) => (x.id === id && x.history?.more
    ? { ...x, items: [...items, ...x.items.slice(x.history.count)], history: { count: items.length, more: false } } : x))))
}

// ---- closing, and Ctrl+Shift+T to bring the last closed thread back ----
const closed: SessionInfo[] = []
let onClosedTab: ((id: string) => void) | null = null
export const setClosedTabHook = (f: ((id: string) => void) | null) => { onClosedTab = f }
export function closeTabs(closing: string[]) {
  // a file tab with unsaved edits stays open and asks in its editor (Save / Discard / Cancel)
  closing = closing.filter((id) => { const f = fileOfTab(id); if (!f || releaseFile(f)) return true; panes.set((p) => activateIn(p, id)); return false })
  if (!closing.length) return
  const all = getSessions()
  for (const id of closing) {
    const s = all.find((x) => x.id === id)
    if (s?.sessionId && s.path && !s.tool && !s.file) closed.push({ id: s.sessionId, title: s.title, project: '', cwd: s.cwd ?? '', updated: Date.now(), started: Date.now(), path: s.path })
  }
  if (closed.length > 20) closed.splice(0, closed.length - 20)
  setSessions((cur) => cur.filter((s) => !closing.includes(s.id)))
  closing.forEach((id) => { if (!fileOfTab(id) && !id.startsWith('tool:')) { void window.api.chatClose(id); onClosedTab?.(id); forgetStatus(id); forgetSent(id) } })
}
// a thread still working (a turn running, or a subagent / shell / workflow of its own) asks first: keep it going in
// the background, or close it (stops it). An idle one just closes. Several at once (Close all) queue up.
export const closeAsks = createStore<string[]>([])
const isWorking = (id: string) => {
  const s = getSessions().find((x) => x.id === id)
  if (!s || s.file || s.tool || s.background) return false
  return s.busy || (getAllStatus().get(id)?.tasks ?? []).some((t) => t.status === 'running')
}
export function closeSession(id: string) {
  if (id.startsWith('script:')) { void window.api.scriptsStop(id.slice(7)); return }
  if (id === 'deploy') { openPage('deploys'); return }
  if (isWorking(id)) { closeAsks.set((q) => (q.includes(id) ? q : [...q, id])); return }
  closeTabs([id])
}
export function answerCloseAsk(id: string, how: 'background' | 'close' | 'cancel') {
  closeAsks.set((q) => q.filter((x) => x !== id))
  if (how === 'background') moveToBackground(id)
  else if (how === 'close') closeTabs([id])
}
export function reopenClosed(): boolean {
  const info = closed.pop()
  if (!info) { notice('No closed thread to reopen'); return false }
  openSession(info)
  return true
}

// hide a tab but keep its process running
export function moveToBackground(id: string) {
  if (!visibleNow().includes(id)) return
  setSessions((all) => all.map((s) => (s.id === id ? { ...s, background: true } : s)))
}

// Ctrl+Tab: the next / previous tab of the focused pane, wrapping round
export function stepTab(d: number) {
  const p = panes.get()
  const tabs = p.panes.find((x) => x.id === p.focus)?.tabs ?? []
  const at = activeId() ? tabs.indexOf(activeId()!) : -1
  if (tabs.length > 1 && at >= 0) activate(tabs[(at + d + tabs.length) % tabs.length])
}
export function tabAt(n: number) {
  const p = panes.get()
  const tabs = p.panes.find((x) => x.id === p.focus)?.tabs ?? []
  if (tabs[n]) activate(tabs[n])
}
export function focusPaneAt(n: number) {
  const p = panes.get().panes[n]
  if (p) panes.set((s) => ({ ...s, focus: p.id }))
}

// Ctrl+.: the thread that has waited longest for you
export function nextNeedsMe(): boolean {
  const rows = live.get().waiting
  if (!rows.length) { notice('Nothing needs you right now'); return false }
  const cur = activeId()
  const i = rows.findIndex((r) => r.id === cur)
  activate(rows[(i + 1) % rows.length].id)
  return true
}

// ---- sending ----
// the message never reached Claude (its process could not start, the folder is gone): the message says so, and the
// thread stops showing as working unless a turn was already running
export const sendFailed = (tabId: string, uuid: string | undefined, wasBusy: boolean) => (e: unknown) => {
  const why = String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  setSessions((all) => all.map((s): Session => {
    if (s.id !== tabId) return s
    const mine = !!uuid && s.items.some((it) => it.kind === 'user' && it.uuid === uuid)
    const items: Item[] = mine
      ? s.items.map((it) => { if (it.kind !== 'user' || it.uuid !== uuid) return it; const { queue: _q, ...rest } = it; return { ...rest, failed: why } })
      : [...s.items, { kind: 'error', text: `The message was not sent: ${why}` }]
    return { ...s, items, busy: wasBusy ? s.busy : false, streaming: wasBusy ? s.streaming : '' }
  }))
}
export type SendMode = 'steer' | 'queue' | 'interrupt'
export function send(targetId: string, text: string, images: Attachment[], mode?: SendMode) {
  const target = getSessions().find((s) => s.id === targetId)
  if (!target) return
  // a message to a snoozed thread brings it back from snooze (opening it alone does not)
  clearSnooze(target.sessionId ?? target.id); clearSnooze(target.id)
  // while Claude works, a message steers the running turn, waits in the queue for the next one, or (interrupt) is
  // queued while the running turn is stopped, so it goes in at once
  const interrupt = !!target.busy && mode === 'interrupt'
  const busyMode = target.busy ? (interrupt ? 'queue' : mode === 'interrupt' ? 'steer' : (mode ?? 'steer')) : undefined
  const queueId = busyMode === 'queue' ? crypto.randomUUID() : undefined
  const uuid = crypto.randomUUID() // the message's id in the transcript too, so Rewind can go back to it
  const item: Item = {
    kind: 'user', text, images: images.map((i) => i.url), at: Date.now(), uuid,
    ...(busyMode === 'steer' ? { steer: true, during: workingOn(target.items) } : {}),
    ...(queueId ? { queue: { id: queueId, pending: true } } : {}),
    ...(interrupt ? { interrupt: true } : {}),
  }
  setSessions((all) => all.map((s) => (s.id === target.id ? { ...s, busy: true, items: [...s.items, item] } : s)))
  keepVisible(target.sessionId ?? target.id) // writing to a closed or archived thread brings it back to the list
  window.api.chatSend(target.id, target.cwd || place.get().folder, target.sessionId, {
    uuid, title: target.title, text, images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })), mode: busyMode, queueId, background: target.background, ...(interrupt ? { interrupt: true } : {}),
  }).catch(sendFailed(target.id, uuid, !!target.busy))
}

// ---- new threads with a prepared first message (not sent) ----
export function threadWithDraft(title: string, text: string, cwd?: string) {
  const s = { ...makeSession(title.slice(0, 60)), cwd: cwd || place.get().folder || place.get().workspace }
  setSessions((all) => [...all, s])
  prefillDraft(s.id, text)
  panes.set((p) => activateIn(p, s.id))
}
// a to-do's "Talk to Claude about this"
export const talkAbout = (t: Todo) => threadWithDraft(t.text, `Let's talk about this to-do: ${t.text}${t.due ? ` (due ${t.due})` : ''}`)
// Diagnose a deploy: a new thread with the prompt filled in, not sent
export const diagnose = (prompt: string, cwd: string) => threadWithDraft('Diagnose deploy', prompt, cwd)

// ---- Stop everything: every turn stopped, every background task stopped; queues are held, wake-ups stay ----
// pause: also hold the wake-ups and automatic continues until Resume
export async function stopEverything(pause = false): Promise<{ threads: number; tasks: number }> {
  const viaMain = await stopEverythingMain(pause)
  if (viaMain.ok) { notice(`Stopped ${viaMain.data.threads} thread${viaMain.data.threads === 1 ? '' : 's'} and ${viaMain.data.tasks} task${viaMain.data.tasks === 1 ? '' : 's'}. ${pause ? 'Wake-ups and continues are paused.' : 'Wake-ups stay scheduled.'}`); return viaMain.data }
  const busy = getSessions().filter((s) => s.busy && !s.tool && !s.file)
  const tasks = [...getAllStatus()].flatMap(([tab, st]) => st.tasks.filter((t) => t.status === 'running').map((t) => ({ tab, id: t.id })))
  await Promise.all([
    ...busy.map((s) => window.api.chatInterrupt(s.id).catch(() => {})),
    ...tasks.map((t) => window.api.chatStopTask(t.tab, t.id).catch(() => false)),
  ])
  notice(`Stopped ${busy.length} thread${busy.length === 1 ? '' : 's'} and ${tasks.length} task${tasks.length === 1 ? '' : 's'}. Wake-ups stay scheduled.`)
  return { threads: busy.length, tasks: tasks.length }
}
// Resume: the held queues go again and paused wake-ups are resumed
export async function resumeEverything(): Promise<boolean> {
  const r = await resumeEverythingMain()
  notice(r.ok ? 'Resumed. Held queues go again.' : `Could not resume: ${r.reason}`)
  return r.ok
}
// what Stop everything would stop, for its confirm line
export function stopEverythingCount(): { threads: number; tasks: number } {
  const threads = getSessions().filter((s) => s.busy && !s.tool && !s.file).length
  const tasks = [...getAllStatus()].reduce((n, [, st]) => n + st.tasks.filter((t) => t.status === 'running').length, 0)
  return { threads, tasks }
}
