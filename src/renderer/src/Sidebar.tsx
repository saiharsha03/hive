// The threads list: live threads waiting for you or working at the top, then saved threads grouped by project
// (or by date), pinned / snoozed / returned / closed sections, search across every thread, bulk selection.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ThreadMenu } from './ThreadMenu'
import type { LiveRow } from './background'
import { clickRow, flagActions, menuTargets, visibleOrder } from './selection'
import { PRESETS, archive, buildSections, clearSnooze, close, pin, presetTime, snooze, stateLabel, untilLabel, useThreads } from './threads'
import { getPref, setPref } from './prefs'
import { Icon } from './ui'
import { useWatchers } from './useWatchers'
import { isDependabotTab } from '../../shared/dependabotCore'

// last message: time for today, otherwise "Oct 28", with the year only when it isn't this year
function lastAt(t: number): string {
  const d = new Date(t)
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

type Live = { waiting: LiveRow[]; working: LiveRow[] }
type GroupBy = 'project' | 'date'

// state of a live row: waiting (blinking amber), failed (red), working (blue)
export const liveLook = (r: LiveRow): { icon: string; cls: string; word: string } =>
  r.state === 'working' ? { icon: 'loading', cls: 's-work spin', word: 'WORKING' }
    : r.note.startsWith('Failed') || r.note.startsWith('failed') ? { icon: 'error', cls: 's-fail', word: 'FAILED' }
      : r.note.startsWith('Finished') ? { icon: 'pass-filled', cls: 's-done', word: 'DONE' }
        : { icon: 'bell-dot', cls: 's-wait blink', word: 'WAITING' }

type Props = {
  activeId: string | null; onOpen: (s: SessionInfo) => void; live: Live; onActivate: (id: string) => void; onCloseLive: (id: string) => void
  onNew?: () => void; footer?: ReactNode; title?: string
}

// the app asks every sidebar to re-read the saved threads (new threads, new titles), at most every 2 s
const refreshers = new Set<() => void>()
let refreshTimer: ReturnType<typeof setTimeout> | undefined
export const refreshThreadList = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refreshers.forEach((f) => f()), 2000) }

export function Sidebar({ activeId, onOpen, live, onActivate, onCloseLive, onNew, footer, title = 'Threads' }: Props) {
  const [listed, setSessions] = useState<SessionInfo[] | null>(null)
  // a watcher's thread shows under the watcher's name, not Claude's auto title
  const { watchers } = useWatchers()
  // each run is its own thread: the latest one shows under Watchers, older runs stay out of the list (they are in the
  // watcher's run list), so no watcher run lands among the user's threads
  const latest = (w: (typeof watchers)[number]) => w.sessionId ?? w.sessionIds?.at(-1) ?? null
  const olderRuns = useMemo(() => new Set(watchers.flatMap((w) => (w.sessionIds ?? []).filter((id) => id !== latest(w)))), [watchers])
  const sessions = useMemo(() => {
    const names = new Map(watchers.flatMap((w) => { const id = latest(w); return id ? [[id, w.name] as const] : [] }))
    const latestIds = new Set(names.keys())
    return listed && listed.filter((s) => !olderRuns.has(s.id) && !(s.watcherRun && !latestIds.has(s.id))).map((s) => (names.has(s.id) ? { ...s, title: names.get(s.id)! } : s))
  }, [listed, watchers, olderRuns])
  const watcherIds = useMemo(() => new Set(watchers.flatMap((w) => { const id = latest(w); return id ? [id] : [] })), [watchers])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [archiveView, setArchiveView] = useState(false)
  const [menu, setMenu] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [snoozing, setSnoozing] = useState(false)
  const [hits, setHits] = useState<SearchResult | null>(null)
  const [status, setStatus] = useState<SearchStatus | null>(null)
  const [groupBy, setGroupByState] = useState<GroupBy>(() => (getPref<string>('threadsGroupBy', 'project') === 'date' ? 'date' : 'project'))
  const setGroupBy = (g: GroupBy) => { setGroupByState(g); setPref('threadsGroupBy', g) }
  const anchor = useRef<string | null>(null)
  const side = useRef<HTMLElement>(null)
  const hover = useRef(false)
  const states = useThreads()

  // the saved threads: at start, and again whenever the app says one changed (a turn ended, a thread renamed itself)
  useEffect(() => {
    const load = () => { void window.api.listSessions().then(setSessions) }
    load()
    refreshers.add(load)
    return () => { refreshers.delete(load) }
  }, [])
  // indexing progress
  useEffect(() => {
    window.api.searchStatus().then(setStatus).catch(() => {})
    return window.api.onSearchProgress(setStatus)
  }, [])
  // keyword search once the box holds 2+ characters; if it fails the instant title match stays
  const text = query.trim()
  useEffect(() => {
    if (text.length < 2) { setHits(null); return }
    let stale = false
    const t = setTimeout(() => {
      window.api.searchQuery(text).then((r) => { if (!stale) setHits(r) }).catch(() => { if (!stale) setHits(null) })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [text, status?.done])
  // snoozes come due while the app is open
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, [])

  // live threads are listed in Waiting / Working at the top, so they leave the saved list below (a search still finds them)
  const q = query.trim().toLowerCase()
  // a watcher's thread stays in the Watchers section (always on top) even while it works or waits, with its live state
  // a watcher's current run (its tab); an older run resumed later (phone, message_thread) is a thread like any other
  const currentTabs = useMemo(() => new Set(watchers.flatMap((w) => (w.tabId ? [w.tabId] : []))), [watchers])
  const isWatcherRow = useCallback((r: LiveRow) => watcherIds.has(r.sessionId ?? '') || watcherIds.has(r.id) || currentTabs.has(r.id), [watcherIds, currentTabs])
  // Dependabot review threads sit in their own folded section (live ones too), out of Waiting / Working and the dates
  const dependabotIds = useMemo(() => new Set((sessions ?? []).filter((s) => s.dependabot).map((s) => s.id)), [sessions])
  const isBotRow = useCallback((r: LiveRow) => !q && (isDependabotTab(r.id) || dependabotIds.has(r.sessionId ?? '')), [dependabotIds, q])
  const liveShown = (rows: LiveRow[]) => rows.filter((r) => !isWatcherRow(r) && !isBotRow(r) && (!q || r.title.toLowerCase().includes(q)))
  const botLive = [...live.waiting, ...live.working].filter((r) => !isWatcherRow(r) && isBotRow(r))
  const watcherLive = useMemo(() => {
    const rows = [...live.waiting, ...live.working]
    const m = new Map(rows.filter(isWatcherRow).map((r) => [r.sessionId ?? r.id, r]))
    // a run just started: its session is not the watcher's yet, so the row under Watchers takes the run tab's status
    for (const w of watchers) { const row = w.tabId ? rows.find((r) => r.id === w.tabId) : undefined; const id = latest(w); if (row && id && !m.has(id)) m.set(id, row) }
    return m
  }, [live, isWatcherRow, watchers])
  const savedRows = useMemo(() => {
    if (archiveView || q) return sessions ?? []
    const hide = new Set([...live.waiting, ...live.working].filter((r) => !isWatcherRow(r)).flatMap((r) => [r.id, r.sessionId ?? '']))
    return (sessions ?? []).filter((s) => !hide.has(s.id))
  }, [sessions, live, archiveView, q, isWatcherRow])
  const sections = useMemo(() => buildSections(savedRows, states, now, query, archiveView, groupBy, watcherIds, dependabotIds), [savedRows, states, now, query, archiveView, groupBy, watcherIds, dependabotIds])
  const archived = useMemo(() => (sessions ?? []).filter((s) => states[s.id]?.archivedAt).length, [sessions, states])
  const searching = query.trim() !== ''

  // bulk selection: only rows on screen count, so a search or a fold can't leave hidden rows selected
  // search hits can be in any thread, an older watcher run too (those are out of the list, not out of search)
  const byId = useMemo(() => new Map([...(listed ?? []), ...(sessions ?? [])].map((s) => [s.id, s])), [listed, sessions])
  const found = useMemo(() => (hits && text.length >= 2 ? hits.results.flatMap((h) => { const s = byId.get(h.sessionId); return s ? [{ s, snippet: h.snippet }] : [] }) : null), [hits, text, byId])
  const order = useMemo(() => (found ? found.map((f) => f.s.id) : visibleOrder(sections, open, searching)), [found, sections, open, searching])
  const ids = useMemo(() => order.filter((id) => picked.has(id)), [order, picked])
  const orderRef = useRef(order)
  orderRef.current = order

  const clearPicked = () => { setPicked(new Set()); setSnoozing(false) }
  useEffect(() => {
    // Ctrl+A when focus is in the list or the mouse is over it; Escape clears. Never while typing in a field.
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') clearPicked()
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'a' && (hover.current || side.current?.contains(document.activeElement))) {
        e.preventDefault()
        setPicked(new Set(orderRef.current))
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  const onRowClick = (e: React.MouseEvent, s: SessionInfo) => {
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl && !e.shiftKey) { anchor.current = s.id; openSession(s); return }
    const next = clickRow(order, { selected: new Set(ids), anchor: anchor.current }, s.id, { ctrl, shift: e.shiftKey })
    anchor.current = next.anchor
    setPicked(next.selected)
  }
  const selectSection = (items: SessionInfo[]) => setPicked(new Set([...ids, ...items.map((s) => s.id)]))
  const apply = (fn: (id: string) => void) => { ids.forEach(fn); clearPicked() }

  const openSession = (s: SessionInfo) => { clearSnooze(s.id); onOpen(s) }
  const toggle = (key: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(key)) n.add(key); return n })

  // the dim word beside a row: its own state where the section doesn't already say it
  const note = (id: string, section: string): string => {
    if (section === 'snoozed') return `until ${untilLabel(states[id].snoozedUntil!, now)}`
    if (section === 'returned') return 'back from snooze'
    if (searching || archiveView) return stateLabel(states[id], now)
    return ''
  }
  const placeIcon = (id: string, section: string) => {
    const st = states[id]
    if (st?.archivedAt) return 'archive'
    if (section === 'pinned' || st?.pinned) return 'pinned'
    if (section === 'snoozed') return 'history'
    if (section === 'returned') return 'bell'
    if (section === 'closed' || st?.closedAt) return 'circle-slash'
    return 'comment-discussion'
  }

  // File Explorer rule: a row inside the selection opens a menu for the whole selection, any other row for itself alone and drops the selection
  const openMenu = (id: string, x: number, y: number) => {
    const targets = menuTargets(ids, id)
    if (targets !== ids) clearPicked()
    setMenu({ ids: targets, x, y })
  }

  const liveRow = (r: LiveRow) => {
    const look = liveLook(r)
    return (
      <div key={r.id} className={`th${r.id === activeId ? ' on' : ''}`} title={r.title} role="button" tabIndex={0} onClick={() => onActivate(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') onActivate(r.id) }} data-testid="live-row" data-id={r.id}>
        <Icon name={look.icon} className={look.cls} />
        <span className="t">{r.title}</span>
        <span className={`st ${look.cls.replace(' spin', '')}`}>{look.word}</span>
        <span className="m">{r.note}</span>
        <button className="more" aria-label="Close thread" title="Close (stops it)" onClick={(e) => { e.stopPropagation(); onCloseLive(r.id) }} data-testid={`thread-live-close-${r.id}`}><Icon name="close" /></button>
      </div>
    )
  }

  const row = (s: SessionInfo, section: string, snippet?: string) => {
    const lr = section === 'watchers' ? watcherLive.get(s.id) : undefined
    const label = lr ? lr.note : note(s.id, section)
    const meta = [groupBy === 'date' || searching || archiveView || !section.startsWith('project:') ? s.project : '', label].filter(Boolean).join(', ')
    return (
      <div
        key={s.id} className={`th${s.id === activeId ? ' on' : ''}${picked.has(s.id) ? ' picked' : ''}`} title={s.title} role="button" tabIndex={0}
        onClick={(e) => onRowClick(e, s)} onKeyDown={(e) => { if (e.key === 'Enter') openSession(s) }}
        onContextMenu={(e) => { e.preventDefault(); openMenu(s.id, e.clientX, e.clientY) }}
        data-testid="thread-row" data-id={s.id}
      >
        {lr ? <Icon name={liveLook(lr).icon} className={liveLook(lr).cls} /> : <Icon name={placeIcon(s.id, section)} className="s-idle" />}
        <span className="t">{s.title}</span>
        {lr ? <span className={`st ${liveLook(lr).cls.replace(' spin', '')}`}>{liveLook(lr).word}</span> : <span className="tm" title="Last message">{lastAt(s.updated)}</span>}
        {meta && <span className="m">{meta}</span>}
        {snippet && <span className="snip">{snippet}</span>}
        <button
          className="more" aria-label="Thread actions"
          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(s.id, r.left, r.bottom) }}
          data-testid="thread-actions"
        ><Icon name="ellipsis" /></button>
      </div>
    )
  }

  const idxLine = status && status.total > 0 && !status.done ? `Indexing threads ${status.indexed}/${status.total}…` : ''

  const groupHead = (key: string, label: string, n: number, icon: string, opts: { fold?: boolean; folded?: boolean; items?: SessionInfo[] } = {}) => (
    <div className="ghead">
      {opts.fold
        ? <button className="grp fold" onClick={() => toggle(key)} data-testid="section-fold"><Icon name={opts.folded ? 'chevron-right' : 'chevron-down'} />{label}<span className="n">{n}</span></button>
        : <div className="grp"><Icon name={icon} />{label}<span className="n">{n}</span></div>}
      {!opts.folded && opts.items && <button className="selall" onClick={() => selectSection(opts.items!)} data-testid={`thread-group-select-${key}`}>Select all</button>}
    </div>
  )

  return (
    <aside className="side threads" ref={side} onMouseEnter={() => { hover.current = true }} onMouseLeave={() => { hover.current = false }} data-testid="sidebar">
      <div className="sidehead">
        <span>{archiveView ? 'Archived' : title}</span>
        <span className="sidehead-acts">
          <button className={groupBy === 'project' ? 'ibtn on' : 'ibtn'} title="Group by project" onClick={() => setGroupBy('project')} data-testid="threads-group-project"><Icon name="folder" /></button>
          <button className={groupBy === 'date' ? 'ibtn on' : 'ibtn'} title="Group by date" onClick={() => setGroupBy('date')} data-testid="threads-group-date"><Icon name="calendar" /></button>
        </span>
      </div>
      {onNew && <button className="newt" onClick={onNew} data-testid="top-new"><Icon name="add" />New thread</button>}
      {ids.length > 0 && (
        <div className="bulk">
          <div className="bulkbar">
            <span className="n">{ids.length} selected</span>
            {flagActions(states, ids, 'archivedAt').map((a) => <button key={a.label} onClick={() => apply((id) => archive(id, a.on))} data-testid="bulk-archive">{a.label}</button>)}
            {flagActions(states, ids, 'closedAt').map((a) => <button key={a.label} onClick={() => apply((id) => close(id, a.on))} data-testid="bulk-close">{a.label}</button>)}
            <button onClick={() => setSnoozing(!snoozing)} data-testid="bulk-snooze">Snooze<Icon name={snoozing ? 'chevron-down' : 'chevron-right'} /></button>
            {flagActions(states, ids, 'pinned').map((a) => <button key={a.label} onClick={() => apply((id) => pin(id, a.on))} data-testid="bulk-pin">{a.label}</button>)}
            <button onClick={clearPicked} data-testid="bulk-clear">Clear</button>
          </div>
          {snoozing && (
            <div className="bulkbar sub">
              {PRESETS.map((p) => <button key={p.id} onClick={() => { const t = presetTime(p.id, Date.now()); apply((id) => snooze(id, t)) }} data-testid={`bulk-snooze-${p.id}`}>{p.label}</button>)}
            </div>
          )}
        </div>
      )}
      <div className="srch"><Icon name="search" /><input placeholder="Search threads and history" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="threads-search" /></div>
      {idxLine && <div className="idx">{idxLine}</div>}
      <div className="tlist">
        {/* in the archive the way back sits first, not below every archived thread */}
        {archiveView && (
          <button className="archlink" onClick={() => setArchiveView(false)} data-testid="archive-view">
            <Icon name="arrow-left" />Back to threads
          </button>
        )}
        {!sessions && <div className="hint">Loading threads…</div>}
        {found && (
          <div>
            {groupHead('search', 'Search results', found.length, 'search')}
            {found.map((f) => row(f.s, 'search', f.snippet))}
            {!found.length && <div className="hint">No matches.</div>}
          </div>
        )}
        {!found && sections.filter((sec) => sec.key === 'watchers').map((sec) => (
          <div key={sec.key} data-testid="section-watchers">
            {groupHead(sec.key, sec.label, sec.items.length, 'eye')}
            {sec.items.map((s) => row(s, 'watchers'))}
          </div>
        ))}
        {!found && !archiveView && ([['waiting', 'Waiting for you', live.waiting, 'bell'], ['working', 'Working', live.working, 'loading']] as const).map(([key, label, rows, icon]) => liveShown(rows).length > 0 && (
          <div key={key} data-testid={`section-${key}`}>
            {groupHead(key, label, liveShown(rows).length, icon)}
            {liveShown(rows).map(liveRow)}
          </div>
        ))}
        {!found && !archiveView && (() => {
          const sec = sections.find((x) => x.key === 'dependabot')
          const n = botLive.length + (sec?.items.length ?? 0)
          if (!n) return null
          const folded = !searching && !open.has('dependabot')
          return (
            <div key="dependabot" data-testid="section-dependabot">
              {groupHead('dependabot', 'Dependabot', n, 'git-pull-request', { fold: true, folded, items: sec?.items })}
              {!folded && botLive.map(liveRow)}
              {!folded && sec?.items.map((s) => row(s, 'dependabot'))}
            </div>
          )
        })()}
        {!found && sessions && !sections.length && <div className="hint">{archiveView ? 'Nothing archived.' : 'No threads yet.'}</div>}
        {!found && sections.filter((sec) => sec.key !== 'watchers' && sec.key !== 'dependabot').map((sec) => {
          // a search opens every fold so no match stays hidden
          const folded = !!sec.fold && !searching && !open.has(sec.key)
          const icon = sec.key.startsWith('project:') ? 'folder' : sec.key === 'pinned' ? 'pinned' : sec.key === 'returned' ? 'bell' : 'calendar'
          return (
            <div key={sec.key} data-testid={`section-${sec.key}`}>
              {groupHead(sec.key, sec.label, sec.items.length, icon, { fold: sec.fold, folded, items: sec.items })}
              {!folded && sec.items.map((s) => row(s, sec.sub ?? sec.key))}
            </div>
          )
        })}
        {archived > 0 && !archiveView && (
          <button className="archlink" onClick={() => setArchiveView(true)} data-testid="archive-view">
            <Icon name="archive" />{`Archived (${archived})`}
          </button>
        )}
      </div>
      {footer}
      {menu && <ThreadMenu ids={menu.ids} states={states} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onDone={clearPicked} />}
    </aside>
  )
}
