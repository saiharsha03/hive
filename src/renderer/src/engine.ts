// Feeds the stores from the main process, once per window: chat events (with reply text batched per animation
// frame and drawn only for threads on screen), threads main starts, the restore of open tabs after a restart, the
// handoff offer, worktree clean-up and the background flag. Started by main.tsx; nothing here renders.
import { HANDOFF_AT_DEFAULT, handoffRequest, handoffStart, shouldOffer } from '../../shared/handoffCore'
import { isWatcherTab } from '../../shared/readOnlyCore'
import { tabsToRestore, tabsToSave } from '../../shared/restoreCore'
import { activateSession, findSession, markWaiting, onSessionEvent, withNeeds } from './background'
import { refreshThreadList } from './Rail'
import { keepVisible, organize, setRetireHandler } from './threads'
import { pruneDrafts, saveTabs, savedTabs } from './restore'
import { reconcile, activate as activateIn, focusedTab } from './panes'
import { createStore, getSessions, panes, sessions, setSessions } from './store'
import { activate, activeId, lastThreadId, setLastThread, notice, openFileTab, openSession, openTerminal, place, recomputeLive, send, sendFailed, setClosedTabHook, setPreview, visibleNow } from './actions'
import { onStatusChange } from './statusStore'
import { setAskFix, setFileOpener } from './EditorView'
import { insertIntoComposer } from './SessionView'
import type { Session } from './chat'

// ---- reply text: joined and drawn once per frame, only for the tabs on screen ----
const deltas = new Map<string, string>()
let frame = 0
let shown = new Set<string>()
function flushDeltas(which: (tab: string) => boolean) {
  const take = new Map([...deltas].filter(([tab]) => which(tab)))
  if (!take.size) return
  for (const tab of take.keys()) deltas.delete(tab)
  const act = activeId()
  setSessions((all) => all.map((s) => (take.has(s.id)
    ? onSessionEvent(s, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: take.get(s.id) } } }, act, Date.now()) : s)))
}

// ---- handoff: a big or just-compacted thread is offered a fresh one (handoffCore) ----
// offer: shown now; dismissed: where Not now was said; pending: the handoff being written (file, asked at);
// failed: the last attempt ended without a usable file. Watcher threads are never offered.
export type HandoffState = { total: number; offer: boolean; dismissed?: { total: number; compactions: number }; pending?: { file: string; since: number }; failed?: boolean }
export const handoffs = createStore<Record<string, HandoffState>>({})
let handoffAtTokens = HANDOFF_AT_DEFAULT
const canHandOff = (s: Session) => !s.tool && !s.file && !isWatcherTab(s.id)
const linksToSession = new Map<string, string>() // new tab id -> the old thread's session id (worktree links)
async function startHandoffThread(from: Session, file: string) {
  handoffs.set((all) => { const { [from.id]: _gone, ...rest } = all; return rest })
  const id = `new-${Date.now()}`
  const moved = from.sessionId ? await window.api.worktreeMove(from.sessionId, id).catch(() => 0) : 0
  if (moved && from.sessionId) linksToSession.set(id, from.sessionId)
  const title = `${from.title} (cont.)`
  const text = handoffStart(from.title, file)
  const { workspace, folder } = place.get()
  const cwd = from.cwd || workspace || folder
  setSessions((all) => [
    ...all.map((s) => (moved && s.id === from.id ? { ...s, worktrees: [] } : s)),
    { id, title, cwd, worktrees: moved ? from.worktrees : undefined, items: [{ kind: 'user', text, images: [], at: Date.now() }], streaming: '', busy: true, loaded: true, background: false },
  ])
  panes.set((p) => activateIn(p, id))
  window.api.chatSend(id, cwd, undefined, { title, text, images: [] }).catch(sendFailed(id, undefined, false))
}
function finishHandoff(s: Session, p: { file: string; since: number }) {
  void window.api.handoffReady(p.file, p.since).catch(() => false).then((ok) => {
    if (handoffs.get()[s.id]?.pending?.file !== p.file) return
    if (ok) return void startHandoffThread(s, p.file)
    handoffs.set((all) => ({ ...all, [s.id]: { ...all[s.id], pending: undefined, offer: true, failed: true } }))
  })
}
export async function handOff(id: string) {
  const since = Date.now()
  const file = await window.api.handoffFile(id)
  const now = getSessions().find((x) => x.id === id)
  if (!now || now.busy) return
  handoffs.set((all) => ({ ...all, [id]: { ...all[id], offer: false, failed: false, pending: { file, since } } }))
  send(id, handoffRequest(file), [])
}
export const notNow = (id: string) => {
  const s = getSessions().find((x) => x.id === id)
  handoffs.set((all) => ({ ...all, [id]: { ...all[id], offer: false, failed: false, dismissed: { total: all[id]?.total ?? 0, compactions: s?.compactions ?? 0 } } }))
}

let started = false
export function startEngine() {
  if (started) return
  started = true
  void window.api.handoffAt().then((n) => { handoffAtTokens = n }).catch(() => {})
  window.api.workspaceRoot().then(async (root) => {
    const start = root || (await window.api.homeDir())
    place.set((p) => ({ workspace: start, folder: p.folder || start }))
  }).catch(() => {})
  // a reload starts with no tabs, so stop any session still running from before it
  void window.api.chatReset()

  // a file opens as a tab next to the threads; its problems go to the thread last on screen
  setFileOpener(openFileTab)
  setAskFix((path, text) => {
    const id = lastThreadId()
    if (!id) { notice('Open a thread first: the problems go into its message box'); return }
    insertIntoComposer(id, text)
    activate(id)
  })
  setClosedTabHook((id) => { deltas.delete(id) })

  // every visible thread sits in one pane; panes follow the sessions
  const sync = () => panes.set((p) => reconcile(p, visibleNow()))
  sessions.subscribe(sync)

  // the tabs on screen (each pane's active one): only their replies are drawn as they stream; a tab that becomes
  // focused is no longer waiting; the working folder follows the focused thread
  let lastFocus: string | null = null
  panes.subscribe(() => {
    const p = panes.get()
    const next = new Set(p.panes.map((x) => x.active ?? '').filter(Boolean))
    const added = [...next].some((t) => !shown.has(t))
    shown = next
    if (added) flushDeltas((t) => shown.has(t))
    const f = focusedTab(p)
    if (f !== lastFocus) {
      lastFocus = f
      if (f && !f.startsWith('tool:') && !f.startsWith('file:')) setLastThread(f)
      if (f && getSessions().some((s) => s.id === f && (s.waitingSince || s.background))) setSessions((all) => activateSession(all, f))
      const cwd = getSessions().find((s) => s.id === f)?.cwd
      if (cwd) place.set((pl) => (pl.folder === cwd ? pl : { ...pl, folder: cwd }))
    }
  })

  // Needs you / Working rows follow threads and their background tasks
  sessions.subscribe(recomputeLive)
  onStatusChange(recomputeLive)

  // every live session's events land here (backgrounded ones too); Claude's "show" opens the file
  window.api.onChatEvent((tabId, ev) => {
    if (ev.type === 'stream_event' && !ev.parent_tool_use_id && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
      deltas.set(tabId, (deltas.get(tabId) ?? '') + ev.event.delta.text)
      if (shown.has(tabId) && !frame) frame = requestAnimationFrame(() => { frame = 0; flushDeltas((t) => shown.has(t)) })
      return
    }
    flushDeltas((t) => t === tabId) // what was written so far goes in before the event that follows it
    const cur = getSessions().find((s) => s.id === tabId)
    if (ev.type === 'hive_show' && ev.path && !cur?.background) setPreview(ev.path)
    if (ev.type === 'hive_title' && ev.title) {
      setSessions((all) => all.map((s) => (s.id === tabId ? { ...s, title: ev.title } : s)))
      refreshThreadList()
      return
    }
    if (ev.type === 'result') refreshThreadList()
    if (ev.type === 'hive_open_terminal') { activate(tabId); openTerminal(tabId); return }
    // the thread's process ended before Claude read these: what you wrote goes back in its message box
    if (ev.type === 'hive_unsent') {
      const mine = (ev.messages ?? []).filter((m: { source: string; text: string }) => m.source === 'you' && m.text.trim())
      for (const m of mine) insertIntoComposer(tabId, m.text)
      const pics = (ev.messages ?? []).reduce((n: number, m: { source: string; images?: unknown[] }) => n + (m.source === 'you' ? m.images?.length ?? 0 : 0), 0)
      if (mine.length || pics) notice(`The thread stopped before Claude read ${mine.length || 'your'} message${mine.length === 1 ? '' : 's'}: back in its message box${pics ? ` (attach the ${pics} picture${pics > 1 ? 's' : ''} again)` : ''}.`)
      return
    }
    if (ev.type === 'hive_organize') {
      if (ev.action === 'waiting') {
        setSessions((all) => all.map((s) => (s.id === tabId ? markWaiting(withNeeds(s, ev.reason), ev.reason, Date.now(), activeId() === s.id && !s.background) : s)))
        return
      }
      if (ev.action === 'resolved') {
        setSessions((all) => all.map((s) => (s.id === tabId ? { ...s, waitingReason: undefined, waitingSince: undefined, needs: undefined } : s)))
        return
      }
      if (cur?.sessionId) organize(cur.sessionId, ev.action, ev.until)
      return
    }
    const act = activeId()
    setSessions((all) => {
      let changed = false
      const next = all.map((s) => { if (s.id !== tabId) return s; const n = onSessionEvent(s, ev, act, Date.now()); if (n !== s) changed = true; return n })
      return changed ? next : all
    })
  })

  // a thread the app started by itself (a watcher's thread) or another thread started or resumed
  window.api.onThread((t) => {
    const known = getSessions().find((s) => s.id === t.tabId)?.sessionId
    for (const id of new Set([t.sessionId, known, t.tabId])) if (id) keepVisible(id)
    // queueId: it waits behind the running turn, like a queued message typed here
    const queue = t.queueId ? { queue: { id: t.queueId, pending: true } } : {}
    const first: Item = t.from ? { kind: 'thread', fromId: t.from.id, fromTitle: t.from.title, text: t.prompt, ...queue } : { kind: 'user', text: t.prompt, images: [], ...queue }
    setSessions((all) => (all.some((s) => s.id === t.tabId) ? all.map((s) => (s.id === t.tabId ? { ...s, busy: true, items: [...s.items, first] } : s)) : [...all, {
      id: t.tabId, title: t.title, cwd: t.cwd, sessionId: t.sessionId, path: t.path, items: [first], streaming: '', busy: true, loaded: !t.path, background: !t.foreground,
    }]))
    if (t.path) window.api.loadRecentHistory(t.path).then(({ items, more }) =>
      setSessions((all) => all.map((s) => (s.id === t.tabId && !s.loaded ? { ...s, items: [...items, ...s.items], loaded: true, history: { count: items.length, more } } : s)))).catch(() => {})
  })

  // a thread closed or archived: the worktrees it made are deleted and the result noted
  setRetireHandler((thread) => {
    window.api.worktreeCleanup(thread).then((notes) => {
      if (!notes.length) return
      notice(...notes)
      void window.api.worktreeLinks(thread).then((left) => setSessions((all) => all.map((s) => (s.sessionId === thread || s.id === thread
        ? { ...s, worktrees: left.map(({ repo, path, branch }) => ({ repo, path, branch })) } : s))))
    }).catch((e) => notice(`Worktree cleanup failed: ${e?.message ?? e}`))
  })

  // background tabs run in auto mode: tell main whenever a session moves between the panes and the background
  const sentBackground = new Map<string, boolean>()
  sessions.subscribe(() => {
    const all = getSessions()
    for (const id of [...sentBackground.keys()]) if (!all.some((s) => s.id === id)) sentBackground.delete(id)
    for (const s of all) {
      if (s.tool || s.file || sentBackground.get(s.id) === s.background) continue
      sentBackground.set(s.id, s.background)
      void window.api.chatSetBackground(s.id, s.background)
    }
  })

  // after a restart the saved threads that were open come back as tabs, history only; tabs are saved only after it
  let restored = false
  void window.api.listSessions().then((list) => {
    pruneDrafts(new Set(list.map((x) => x.id)))
    const { open, focus } = tabsToRestore(savedTabs(), list)
    for (const info of open) if (!findSession(getSessions(), info.id)) openSession(info)
    if (focus) panes.set((p) => activateIn(p, focus))
    restored = true
  }).catch(() => { restored = true })
  const save = () => { if (restored) saveTabs(tabsToSave(getSessions(), panes.get().panes.flatMap((p) => p.tabs), activeId())) }
  sessions.subscribe(save)
  panes.subscribe(save)

  // handoff: when a thread's turn ends, finish a pending handoff, else check a foreground thread's size
  const wasBusy = new Map<string, boolean>()
  let prev: Session[] = []
  sessions.subscribe(() => {
    const all = getSessions()
    if (all === prev) return
    prev = all
    for (const s of all) {
      if (s.sessionId && linksToSession.delete(s.id)) void window.api.worktreeMove(s.id, s.sessionId).catch(() => {})
      const was = wasBusy.get(s.id) ?? false
      wasBusy.set(s.id, s.busy)
      if (!was || s.busy || !canHandOff(s)) continue
      const pending = handoffs.get()[s.id]?.pending
      if (pending) { finishHandoff(s, pending); continue }
      if (s.background) continue
      const compactions = s.compactions ?? 0
      void window.api.chatContext(s.id).then((c) => handoffs.set((cur) => {
        const before = cur[s.id]
        const total = c?.total ?? 0
        const offer = shouldOffer({ total, compactions, dismissed: before?.dismissed }, handoffAtTokens)
        return offer || before ? { ...cur, [s.id]: { ...before, total, offer, failed: false } } : cur
      })).catch(() => {})
    }
    const ids = new Set(all.map((s) => s.id))
    for (const [tab, back] of linksToSession) if (!ids.has(tab)) {
      linksToSession.delete(tab)
      void window.api.worktreeMove(tab, back).then(() => window.api.worktreeLinks(back)).then((left) => setSessions((cur) => cur.map((x) => (x.sessionId === back ? { ...x, worktrees: left.map(({ repo, path, branch }) => ({ repo, path, branch })) } : x)))).catch(() => {})
    }
    if (Object.keys(handoffs.get()).some((id) => !ids.has(id))) handoffs.set((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => ids.has(id))))
    for (const id of [...wasBusy.keys()]) if (!ids.has(id)) wasBusy.delete(id)
  })

  // the Team window asks: show a thread here, or say something in it like typing in its tab
  window.api.onActivateThread((id) => activate(findSession(getSessions(), id)?.id ?? id))
  window.api.onSay((id, text) => { if (getSessions().some((x) => x.id === id)) send(id, text, []) })
}
