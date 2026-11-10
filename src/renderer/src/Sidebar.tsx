// The threads list: live threads waiting for you or working at the top, then saved threads grouped by project
// (or by date), pinned / snoozed / returned / closed sections, search across every thread, bulk selection.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ThreadMenu } from './ThreadMenu'
import type { LiveRow } from './background'
import { clickRow, flagActions, menuTargets, visibleOrder } from './selection'
import { PRESETS, archive, buildSections, clearSnooze, close, pin, presetTime, snooze, stateLabel, untilLabel, useThreads, type Section } from './threads'
import { getPref, setPref } from './prefs'
import { Confirm, Icon, useEscape } from './ui'
import { useWatchers } from './useWatchers'
import { isDependabotTab } from '../../shared/dependabotCore'
import { nextRunLabel } from '../../shared/threadsCore'
import { groupTeams, pastTeamPeople, roleIcon, teamThreadIds, type Roster, type RosterPerson, type TeamWord } from '../../shared/teamSidebarCore'

// last message: time for today, otherwise "Oct 28", with the year only when it isn't this year
function lastAt(t: number): string {
  const d = new Date(t)
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

type Live = { waiting: LiveRow[]; working: LiveRow[] }
const TEAM_CLASS: Record<TeamWord, string> = { PAUSED: 's-wait', WORKING: 's-work', IDLE: 's-idle' }
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
  onTeam?: (teamId: string) => void // a team's row: open the Team view on it
  onSaved?: (list: SessionInfo[]) => void // the saved threads as just read (tabs take their titles from it)
}

// The saved threads are read once for every list on screen (the sidebar, the All threads popover) and handed to each.
// The app asks for a new read when a thread is saved or renamed: the first ask is answered after a moment, more asks
// within 2 s share one read at the end of them, so a busy desk reads at most every 2 s and never waits for quiet.
const REFRESH_MS = 2000
const refreshers = new Set<(list: SessionInfo[]) => void>()
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let lastRefresh = 0
const readSaved = () => { lastRefresh = Date.now(); void window.api.listSessions().then((list) => refreshers.forEach((f) => f(list))).catch(() => {}) }
export const refreshThreadList = () => {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => { refreshTimer = undefined; readSaved() }, Math.max(300, lastRefresh + REFRESH_MS - Date.now()))
}

// rows drawn per section until "Show more": a project with hundreds of threads does not put them all in the page
const CAP = 50

// Up / Down (Home / End) move the focus between the visible rows, in page order
const rowArrows = (e: React.KeyboardEvent<HTMLElement>) => {
  const keys: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, Home: -Infinity, End: Infinity }
  const t = e.target as HTMLElement
  if (!(e.key in keys) || e.ctrlKey || e.altKey || e.shiftKey || !t.classList.contains('th')) return
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.th')]
  const at = rows.indexOf(t)
  const to = Math.max(0, Math.min(rows.length - 1, Number.isFinite(keys[e.key]) ? at + keys[e.key] : keys[e.key] < 0 ? 0 : rows.length - 1))
  e.preventDefault()
  rows[to]?.focus()
}

// The frame: it re-renders with the app (its footer is the app's), while the list inside is memoised and gets
// functions that never change (they call the newest ones), so it re-renders only when the threads or its own state do.
export function Sidebar(p: Props) {
  const side = useRef<HTMLElement>(null)
  const hover = useRef(false)
  const latest = useRef(p)
  latest.current = p
  const fns = useMemo(() => ({
    onOpen: (s: SessionInfo) => latest.current.onOpen(s),
    onActivate: (id: string) => latest.current.onActivate(id),
    onCloseLive: (id: string) => latest.current.onCloseLive(id),
    onNew: () => latest.current.onNew?.(),
    onTeam: (id: string) => latest.current.onTeam?.(id),
    onSaved: (list: SessionInfo[]) => latest.current.onSaved?.(list),
  }), [])
  return (
    <aside className="side threads" ref={side} onMouseEnter={() => { hover.current = true }} onMouseLeave={() => { hover.current = false }} onKeyDown={rowArrows} data-testid="sidebar">
      <ThreadList activeId={p.activeId} live={p.live} title={p.title ?? 'Threads'} hasNew={!!p.onNew} side={side} hover={hover} {...fns} />
      {p.footer}
    </aside>
  )
}

type ListProps = {
  activeId: string | null; live: Live; title: string; hasNew: boolean; side: RefObject<HTMLElement | null>; hover: RefObject<boolean>
  onOpen: (s: SessionInfo) => void; onActivate: (id: string) => void; onCloseLive: (id: string) => void; onNew: () => void; onTeam: (id: string) => void; onSaved: (list: SessionInfo[]) => void
}
type Retiring = { kind: 'close' | 'archive'; ids: string[]; trees: { thread: string; repo: string; branch: string; path: string }[] }

const ThreadList = memo(function ThreadList({ activeId, onOpen, live, onActivate, onCloseLive, onNew, hasNew, title, onTeam, onSaved, side, hover }: ListProps) {
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
  // a watcher's row says when it runs next while it is not running
  const watcherOf = useMemo(() => new Map(watchers.flatMap((w) => { const id = latest(w); return id ? [[id, w] as const] : [] })), [watchers])
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
  const states = useThreads()
  const [more, setMore] = useState<Set<string>>(new Set())
  const [retiring, setRetiring] = useState<Retiring | null>(null)

  // the saved threads: at start, and again whenever the app says one changed (a turn ended, a thread renamed itself)
  useEffect(() => {
    const take = (list: SessionInfo[]) => { setSessions(list); onSaved(list) }
    refreshers.add(take)
    readSaved()
    return () => { refreshers.delete(take) }
  }, [onSaved])
  // running teams (Lead first, then members): their threads sit in the Teams section, not in the lists below;
  // an ended team's threads go back to the lists, still marked as team threads
  const [allRosters, setRosters] = useState<Roster[]>([])
  const rosters = useMemo(() => allRosters.filter((r) => !r.endedAt), [allRosters])
  const past = useMemo(() => pastTeamPeople(allRosters), [allRosters])
  useEffect(() => {
    const load = () => { void window.api.teamRoster().then(setRosters).catch(() => setRosters([])) }
    load()
    return window.api.onTeamsChanged(load)
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
  // a search finds team threads in the normal lists, like Dependabot's
  const teamIds = useMemo(() => (q ? new Set<string>() : teamThreadIds(rosters)), [rosters, q])
  const isTeamRow = (r: LiveRow) => teamIds.has(r.id) || teamIds.has(r.sessionId ?? '')
  const liveShown = (rows: LiveRow[]) => rows.filter((r) => !isWatcherRow(r) && !isBotRow(r) && !isTeamRow(r) && (!q || r.title.toLowerCase().includes(q)))
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
    return (sessions ?? []).filter((s) => !hide.has(s.id) && !teamIds.has(s.id))
  }, [sessions, live, archiveView, q, isWatcherRow, teamIds])
  const teams = useMemo(() => (q || archiveView ? [] : groupTeams(rosters, [...live.waiting, ...live.working], sessions ?? [])), [rosters, live, sessions, q, archiveView])
  const sections = useMemo(() => buildSections(savedRows, states, now, query, archiveView, groupBy, watcherIds, dependabotIds), [savedRows, states, now, query, archiveView, groupBy, watcherIds, dependabotIds])
  // the order the sections are drawn in (Dependabot right under Watchers' live rows), for shift-click ranges
  const rendered = useMemo(() => [...sections.filter((x) => x.key === 'watchers'), ...sections.filter((x) => x.key === 'dependabot'), ...sections.filter((x) => x.key !== 'watchers' && x.key !== 'dependabot')], [sections])
  const archived = useMemo(() => (sessions ?? []).filter((s) => states[s.id]?.archivedAt).length, [sessions, states])
  const searching = query.trim() !== ''

  // bulk selection: only rows on screen count, so a search or a fold can't leave hidden rows selected
  // search hits can be in any thread, an older watcher run too (those are out of the list, not out of search)
  const byId = useMemo(() => new Map([...(listed ?? []), ...(sessions ?? [])].map((s) => [s.id, s])), [listed, sessions])
  const found = useMemo(() => (hits && text.length >= 2 ? hits.results.flatMap((h) => { const s = byId.get(h.sessionId); return s ? [{ s, snippet: h.snippet }] : [] }) : null), [hits, text, byId])
  // a long section shows its first rows until "Show more" (a search shows every match)
  const shownOf = useCallback((sec: Section<SessionInfo>) => (searching || more.has(sec.key) || sec.items.length <= CAP ? sec.items : sec.items.slice(0, CAP)), [searching, more])
  const order = useMemo(() => (found ? found.map((f) => f.s.id) : visibleOrder(rendered.map((sec) => ({ ...sec, items: shownOf(sec) })), open, searching)), [found, rendered, open, searching, shownOf])
  const ids = useMemo(() => order.filter((id) => picked.has(id)), [order, picked])
  const orderRef = useRef(order)
  orderRef.current = order

  const clearPicked = () => { setPicked(new Set()); setSnoozing(false) }
  // Escape clears the selection (after any menu or dialog above it has closed); never while typing in a field
  useEscape((e) => {
    if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return false
    clearPicked()
  }, picked.size > 0)
  useEffect(() => {
    // Ctrl+A when focus is in the list or the mouse is over it. Never while typing in a field.
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'a' && (hover.current || side.current?.contains(document.activeElement))) {
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
  // Closing or archiving a thread deletes the worktrees it made. When any of these threads has some, ask first and
  // list them; with none there is nothing to lose and it goes ahead.
  const doRetire = (kind: Retiring['kind'], targets: string[]) => { targets.forEach((id) => (kind === 'close' ? close(id, true) : archive(id, true))); clearPicked() }
  const retire = async (kind: Retiring['kind'], targets: string[]) => {
    const titleOf = (id: string) => byId.get(id)?.title ?? id
    const per = await Promise.all(targets.map((id) => window.api.worktreeLinks(id).then((links) => links.map((l) => ({ thread: titleOf(id), repo: l.repo, branch: l.branch, path: l.path }))).catch(() => [])))
    const trees = per.flat()
    if (trees.length) setRetiring({ kind, ids: targets, trees }); else doRetire(kind, targets)
  }

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

  // a team member's role as a word before the row's note: "BUILDER Builder PR5", "LEAD"
  const roleLine = (who: RosterPerson | undefined, rest: string) => (who
    ? <span className="m"><span className="trole">{who.role.toUpperCase()}</span>{who.name.toLowerCase() !== who.role.toLowerCase() && who.name !== 'Lead' ? ` ${who.name}` : ''}{rest ? `, ${rest}` : ''}</span>
    : rest ? <span className="m">{rest}</span> : null)

  const liveRow = (r: LiveRow, who: RosterPerson | undefined = past.get(r.id) ?? (r.sessionId ? past.get(r.sessionId) : undefined)) => {
    const look = liveLook(r)
    return (
      <div key={r.id} className={`th${r.id === activeId ? ' on' : ''}`} title={r.title} role="button" tabIndex={0} onClick={() => onActivate(r.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onActivate(r.id) } }} data-testid="live-row" data-id={r.id}>
        <Icon name={who ? roleIcon(who.role) : look.icon} className={who ? look.cls.replace(' spin', '') : look.cls} />
        <span className="t">{r.title}</span>
        <span className={`st ${look.cls.replace(' spin', '')}`}>{look.word}</span>
        {roleLine(who, r.note ?? '')}
        <button className="more" aria-label="Close thread" title="Close (stops it)" onClick={(e) => { e.stopPropagation(); onCloseLive(r.id) }} data-testid={`thread-live-close-${r.id}`}><Icon name="close" /></button>
      </div>
    )
  }

  const row = (s: SessionInfo, section: string, snippet?: string, who: RosterPerson | undefined = past.get(s.id)) => {
    const lr = section === 'watchers' ? watcherLive.get(s.id) : undefined
    const w = section === 'watchers' ? watcherOf.get(s.id) : undefined
    const label = lr ? lr.note : (w && nextRunLabel(w, now)) || note(s.id, section)
    const meta = [groupBy === 'date' || searching || archiveView || !section.startsWith('project:') ? s.project : '', label].filter(Boolean).join(', ')
    return (
      <div
        key={s.id} className={`th${s.id === activeId ? ' on' : ''}${picked.has(s.id) ? ' picked' : ''}`} title={s.title} role="button" tabIndex={0}
        onClick={(e) => onRowClick(e, s)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSession(s) }
          else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openMenu(s.id, r.left + 24, r.bottom) }
        }}
        onContextMenu={(e) => { e.preventDefault(); openMenu(s.id, e.clientX, e.clientY) }}
        data-testid="thread-row" data-id={s.id}
      >
        {who ? <Icon name={roleIcon(who.role)} className="s-idle" /> : lr ? <Icon name={liveLook(lr).icon} className={liveLook(lr).cls} /> : <Icon name={placeIcon(s.id, section)} className="s-idle" />}
        <span className="t">{s.title}</span>
        {lr ? <span className={`st ${liveLook(lr).cls.replace(' spin', '')}`}>{liveLook(lr).word}</span> : <span className="tm" title="Last message">{lastAt(s.updated)}</span>}
        {who ? roleLine(who, meta) : meta && <span className="m">{meta}</span>}
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
    <>
      <div className="sidehead">
        <span>{archiveView ? 'Archived' : title}</span>
        <span className="sidehead-acts">
          <button className={groupBy === 'project' ? 'ibtn on' : 'ibtn'} title="Group by project" onClick={() => setGroupBy('project')} data-testid="threads-group-project"><Icon name="folder" /></button>
          <button className={groupBy === 'date' ? 'ibtn on' : 'ibtn'} title="Group by date" onClick={() => setGroupBy('date')} data-testid="threads-group-date"><Icon name="calendar" /></button>
        </span>
      </div>
      {hasNew && <button className="newt" onClick={onNew} data-testid="top-new"><Icon name="add" />New thread</button>}
      {ids.length > 0 && (
        <div className="bulk">
          <div className="bulkbar">
            <span className="n">{ids.length} selected</span>
            {flagActions(states, ids, 'archivedAt').map((a) => <button key={a.label} onClick={() => (a.on ? void retire('archive', ids) : apply((id) => archive(id, false)))} data-testid="bulk-archive">{a.label}</button>)}
            {flagActions(states, ids, 'closedAt').map((a) => <button key={a.label} onClick={() => (a.on ? void retire('close', ids) : apply((id) => close(id, false)))} data-testid="bulk-close">{a.label}</button>)}
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
        {!found && (() => {
          // a run that just started points the watcher at a session the saved list has not picked up yet: its live
          // run row stands in, so the watcher never drops out of the sidebar for those seconds
          const sec = sections.find((x) => x.key === 'watchers')
          const shown = new Set((sec?.items ?? []).map((s) => s.id))
          const runs = [...live.waiting, ...live.working]
          const gap = watchers.filter((w) => { const id = latest(w); return !id || !shown.has(id) })
            .flatMap((w) => { const r = w.tabId ? runs.find((x) => x.id === w.tabId) : undefined; return r ? [{ ...r, title: w.name }] : [] })
          const n = (sec?.items.length ?? 0) + gap.length
          return n > 0 && (
            <div key="watchers" data-testid="section-watchers">
              {groupHead('watchers', sec?.label ?? 'Watchers', n, 'eye')}
              {sec?.items.map((s) => row(s, 'watchers'))}
              {gap.map((r) => liveRow(r))}
            </div>
          )
        })()}
        {!found && !archiveView && ([['waiting', 'Waiting for you', live.waiting, 'bell'], ['working', 'Working', live.working, 'loading']] as const).map(([key, label, rows, icon]) => liveShown(rows).length > 0 && (
          <div key={key} data-testid={`section-${key}`}>
            {groupHead(key, label, liveShown(rows).length, icon)}
            {liveShown(rows).map((r) => liveRow(r))}
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
              {!folded && botLive.map((r) => liveRow(r))}
              {!folded && sec?.items.map((s) => row(s, 'dependabot'))}
            </div>
          )
        })()}
        {!found && teams.length > 0 && (
          <div key="teams" data-testid="section-teams">
            {groupHead('teams', 'Teams', teams.length, 'organization')}
            {teams.map((g) => {
              const key = `team:${g.roster.id}`
              const folded = !open.has(key)
              return (
                <div key={key} className="tteam" data-testid="team-group" data-id={g.roster.id}>
                  <div className="th" title={g.roster.name} role="button" tabIndex={0} onClick={() => onTeam(g.roster.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTeam(g.roster.id) } }} data-testid="team-row">
                    <button className="tchev" aria-label={folded ? 'Show members' : 'Hide members'} onClick={(e) => { e.stopPropagation(); toggle(key) }} data-testid="team-fold"><Icon name={folded ? 'chevron-right' : 'chevron-down'} /></button>
                    <span className="t">{g.roster.name}</span>
                    <span className={`st ${TEAM_CLASS[g.word]}`}>{g.word}</span>
                    <span className="m">{g.working}/{g.total} working</span>
                    <button className="more" aria-label="Open in window" title="Open the team in its own window" onClick={(e) => { e.stopPropagation(); void window.api.teamOpenWindow(g.roster.id) }} data-testid="team-row-window"><Icon name="link-external" /></button>
                  </div>
                  {!folded && <div className="tteam-ms">{g.rows.map((x) => (x.kind === 'live' ? liveRow(x.row, x.person) : row(x.s, 'team', undefined, x.person)))}</div>}
                </div>
              )
            })}
          </div>
        )}
        {!found && sessions && !sections.length && !teams.length && <div className="hint">{archiveView ? 'Nothing archived.' : 'No threads yet.'}</div>}
        {!found && sections.filter((sec) => sec.key !== 'watchers' && sec.key !== 'dependabot').map((sec) => {
          // a search opens every fold so no match stays hidden
          const folded = !!sec.fold && !searching && !open.has(sec.key)
          const icon = sec.key.startsWith('project:') ? 'folder' : sec.key === 'pinned' ? 'pinned' : sec.key === 'returned' ? 'bell' : 'calendar'
          const shown = shownOf(sec)
          return (
            <div key={sec.key} data-testid={`section-${sec.key}`}>
              {groupHead(sec.key, sec.label, sec.items.length, icon, { fold: sec.fold, folded, items: shown })}
              {!folded && shown.map((s) => row(s, sec.sub ?? sec.key))}
              {!folded && shown.length < sec.items.length && (
                <button className="archlink" onClick={() => setMore((m) => new Set(m).add(sec.key))} data-testid={`section-more-${sec.key}`}>
                  <Icon name="chevron-down" />{`Show ${sec.items.length - shown.length} more`}
                </button>
              )}
            </div>
          )
        })}
        {archived > 0 && !archiveView && (
          <button className="archlink" onClick={() => setArchiveView(true)} data-testid="archive-view">
            <Icon name="archive" />{`Archived (${archived})`}
          </button>
        )}
      </div>
      {menu && <ThreadMenu ids={menu.ids} states={states} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onDone={clearPicked} onRetire={(kind, targets) => void retire(kind, targets)} />}
      {retiring && (
        <Confirm
          title={`${retiring.kind === 'close' ? 'Close' : 'Archive'} ${retiring.ids.length === 1 ? 'this thread' : `${retiring.ids.length} threads`} and delete ${retiring.trees.length === 1 ? 'its worktree' : `${retiring.trees.length} worktrees`}?`}
          action={`${retiring.kind === 'close' ? 'Close' : 'Archive'} and delete`} danger testid="retire-confirm"
          onCancel={() => setRetiring(null)} onConfirm={() => { const r = retiring; setRetiring(null); doRetire(r.kind, r.ids) }}
        >
          <div>{retiring.kind === 'close' ? 'Closing' : 'Archiving'} a thread deletes the worktrees it made. Uncommitted changes in them are first saved as a "WIP: auto-saved when thread closed" commit on their branch, and the branch is kept (nothing is pushed). Only files git ignores (build output, the copied .env files) are deleted with the folder. If that commit fails (a hook), the worktree is kept as it is.</div>
          <div className="confirm-list" data-testid="retire-worktrees">
            {retiring.trees.map((t) => <div key={t.path} title={`${t.path}\nthread: ${t.thread}`}>{t.repo} on {t.branch} ({t.thread})</div>)}
          </div>
        </Confirm>
      )}
    </>
  )
})
