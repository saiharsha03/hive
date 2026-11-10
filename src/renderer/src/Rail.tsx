// The rail: every thread, watcher and team sorted by what it needs from you. Needs you (amber), Working, Recent;
// each row is two lines: title and age, then a state word and what it is doing now. Watchers, team leads and
// background threads are rows with a kind word; team members fold under their lead. The view links sit at the foot.
// It re-renders only when the live rows, the saved list, the organisation or the panes on screen change.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ThreadMenu } from './ThreadMenu'
import type { LiveRow } from './background'
import { clickRow, flagActions, menuTargets } from './selection'
import { PRESETS, archive, buildSections, clearSnooze, close, pin, presetTime, snooze, untilLabel, useThreads, type Section } from './threads'
import { getPref, setPref } from './prefs'
import { Confirm, useEscape } from './ui'
import { useWatchers } from './useWatchers'
import { isDependabotTab } from '../../shared/dependabotCore'
import { nextRunLabel } from '../../shared/threadsCore'
import { groupTeams, pastTeamPeople, teamThreadIds, type Roster, type RosterPerson } from '../../shared/teamSidebarCore'
import { live as liveStore, activate, newSession, offerUndo, openBeside, openPage, openPageBeside, openSession, closeSession } from './actions'
import { panes, sessions as sessionStore, useStore, shallowEq } from './store'
import { onWakeupsChanged, wakeupsList } from './api/next'
import { focusedTab } from './panes'
import { age, clock, State, type Tone } from './kit'
import { PAGE_LABEL, type ToolTab } from './chat'

// a live row's state word: waiting (amber), failed (red), finished (green), working (cyan)
export const liveLook = (r: LiveRow): { word: string; tone: Tone; icon: string; cls: string } =>
  r.state === 'working' ? { word: 'WORKING', tone: 'work', icon: 'loading', cls: 's-work spin' }
    : /^failed/i.test(r.note) ? { word: 'FAILED', tone: 'fail', icon: 'error', cls: 's-fail' }
      : r.note.startsWith('Finished') ? { word: 'DONE', tone: 'done', icon: 'pass-filled', cls: 's-done' }
        : { word: 'WAITING', tone: 'wait', icon: 'bell-dot', cls: 's-wait' }
// "Finished: all tests pass" reads as its sentence once the word says DONE
const noteOf = (r: LiveRow) => r.note.replace(/^(Finished|Failed):\s*/, '')

// The saved threads are read once for every list on screen and handed to each. The app asks for a new read when a
// thread is saved or renamed: asks within 2 s share one read at the end of them.
const REFRESH_MS = 2000
const refreshers = new Set<(list: SessionInfo[]) => void>()
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let lastRefresh = 0
const readSaved = () => { lastRefresh = Date.now(); void window.api.listSessions().then((list) => refreshers.forEach((f) => f(list))).catch(() => {}) }
export const refreshThreadList = () => {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => { refreshTimer = undefined; readSaved() }, Math.max(300, lastRefresh + REFRESH_MS - Date.now()))
}
// the saved list as a hook, for the palette and the pages
export function useSavedThreads(): SessionInfo[] | null {
  const [list, setList] = useState<SessionInfo[] | null>(null)
  useEffect(() => { refreshers.add(setList); readSaved(); return () => { refreshers.delete(setList) } }, [])
  return list
}

const CAP = 50
type GroupBy = 'project' | 'date'
type Retiring = { kind: 'close' | 'archive'; ids: string[]; trees: { thread: string; repo: string; branch: string; path: string }[] }

// the panes' focused tab and the tabs on screen, as one small value
const onScreen = (p: ReturnType<typeof panes.get>) => ({ focus: focusedTab(p), shown: p.panes.map((x) => x.active ?? '').join(' ') })

export type ViewSummary = Partial<Record<ToolTab, { text: string; warm?: boolean }>>

export function Rail({ views, currentPage }: { views: ViewSummary; currentPage: ToolTab | null }) {
  const live = useStore(liveStore, (l) => l)
  const scr = useStore(panes, onScreen, shallowEq)
  const shown = useMemo(() => new Set(scr.shown.split(' ').filter(Boolean)), [scr.shown])
  return (
    <aside className="rail" data-testid="sidebar" aria-label="Threads">
      <button className="rail-new" onClick={() => newSession()} data-testid="top-new"><span>New thread</span><span className="keys">Ctrl N</span></button>
      <RailList live={live} focus={scr.focus} shown={shown} />
      <nav className="rail-views" aria-label="Views">
        {(['running', 'scheduled', 'deploys', 'status', 'watchers', 'workspace', 'settings'] as ToolTab[]).map((v) => (
          <button key={v} className={`rail-view${currentPage === v ? ' on' : ''}${v === 'settings' ? ' settings' : ''}`} onClick={(e) => (e.shiftKey ? openPageBeside(v) : openPage(v))} title="Shift+click opens it beside the current pane" data-testid={`rail-view-${v}`}>
            <span>{PAGE_LABEL[v]}</span>{views[v] && <b className={views[v]!.warm ? 'warm' : ''}>{views[v]!.text}</b>}
          </button>
        ))}
      </nav>
    </aside>
  )
}

// Up / Down (Home / End) move between rows; Enter opens; Space opens in a new pane
const rowKeys = (e: React.KeyboardEvent<HTMLElement>) => {
  const keys: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, Home: -Infinity, End: Infinity }
  const t = e.target as HTMLElement
  if (!(e.key in keys) || e.ctrlKey || e.altKey || e.shiftKey || !t.classList.contains('rail-row')) return
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.rail-row')]
  const at = rows.indexOf(t)
  const to = Math.max(0, Math.min(rows.length - 1, Number.isFinite(keys[e.key]) ? at + keys[e.key] : keys[e.key] < 0 ? 0 : rows.length - 1))
  e.preventDefault()
  rows[to]?.focus()
}

const RailList = memo(function RailList({ live, focus, shown }: { live: { waiting: LiveRow[]; working: LiveRow[] }; focus: string | null; shown: Set<string> }) {
  const listed = useSavedThreads()
  // threads running in the background (no tab) carry the kind word "background"
  const background = useStore(sessionStore, (all) => all.filter((s) => s.background).map((s) => s.id).join(' '))
  const bgIds = useMemo(() => new Set(background.split(' ').filter(Boolean)), [background])
  // threads stopped by a usage limit that continue by themselves: PAUSED in Working, with the time
  const [continues, setContinues] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    const load = () => void wakeupsList().then((r) => setContinues(new Map(r.ok ? r.data.continues.flatMap((c) => [[c.key, c.at] as const, [c.tabId, c.at] as const]) : [])))
    load()
    const t = setInterval(load, 60_000)
    const off = onWakeupsChanged(load)
    return () => { clearInterval(t); off() }
  }, [])
  const { watchers } = useWatchers()
  const latestRun = (w: (typeof watchers)[number]) => w.sessionId ?? w.sessionIds?.at(-1) ?? null
  const olderRuns = useMemo(() => new Set(watchers.flatMap((w) => (w.sessionIds ?? []).filter((id) => id !== latestRun(w)))), [watchers])
  const watcherOf = useMemo(() => new Map(watchers.flatMap((w) => { const id = latestRun(w); return id ? [[id, w] as const] : [] })), [watchers])
  const sessions = useMemo(() => listed && listed.filter((s) => !olderRuns.has(s.id) && !(s.watcherRun && !watcherOf.has(s.id))).map((s) => (watcherOf.has(s.id) ? { ...s, title: watcherOf.get(s.id)!.name } : s)), [listed, olderRuns, watcherOf])
  const watcherIds = useMemo(() => new Set(watcherOf.keys()), [watcherOf])
  const watcherTabs = useMemo(() => new Map(watchers.flatMap((w) => (w.tabId ? [[w.tabId, w] as const] : []))), [watchers])
  const states = useThreads()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, [])
  const [groupBy, setGroupByState] = useState<GroupBy>(() => (getPref<string>('threadsGroupBy', 'date') === 'project' ? 'project' : 'date'))
  const setGroupBy = (g: GroupBy) => { setGroupByState(g); setPref('threadsGroupBy', g) }
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(key)) n.add(key); return n })
  const [more, setMore] = useState<Set<string>>(new Set())
  const [archiveView, setArchiveView] = useState(false)
  const [menu, setMenu] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [snoozing, setSnoozing] = useState(false)
  const [retiring, setRetiring] = useState<Retiring | null>(null)
  const anchor = useRef<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // running teams: the lead is a row, members fold under it
  const [allRosters, setRosters] = useState<Roster[]>([])
  useEffect(() => {
    const load = () => { void window.api.teamRoster().then(setRosters).catch(() => setRosters([])) }
    load()
    return window.api.onTeamsChanged(load)
  }, [])
  const rosters = useMemo(() => allRosters.filter((r) => !r.endedAt), [allRosters])
  const past = useMemo(() => pastTeamPeople(allRosters), [allRosters])
  const teamIds = useMemo(() => teamThreadIds(rosters), [rosters])
  const isTeam = useCallback((r: { id: string; sessionId?: string }) => teamIds.has(r.id) || teamIds.has(r.sessionId ?? ''), [teamIds])
  const dependabotIds = useMemo(() => new Set((sessions ?? []).filter((s) => s.dependabot).map((s) => s.id)), [sessions])
  const isBot = useCallback((r: LiveRow) => isDependabotTab(r.id) || dependabotIds.has(r.sessionId ?? ''), [dependabotIds])
  const watcherFor = useCallback((r: LiveRow) => watcherOf.get(r.sessionId ?? '') ?? watcherOf.get(r.id) ?? watcherTabs.get(r.id), [watcherOf, watcherTabs])

  const teams = useMemo(() => (archiveView ? [] : groupTeams(rosters, [...live.waiting, ...live.working], sessions ?? [])), [rosters, live, sessions, archiveView])
  const waitingRows = live.waiting.filter((r) => !isTeam(r))
  const workingRows = live.working.filter((r) => !isTeam(r))
  const liveIds = useMemo(() => new Set([...live.waiting, ...live.working].flatMap((r) => [r.id, r.sessionId ?? ''])), [live])
  const pausedRows = useMemo(() => (archiveView ? [] : (sessions ?? []).filter((s) => continues.has(s.id) && !liveIds.has(s.id))), [sessions, continues, liveIds, archiveView])
  const savedRows = useMemo(() => {
    if (archiveView) return sessions ?? []
    return (sessions ?? []).filter((s) => !liveIds.has(s.id) && !teamIds.has(s.id) && !continues.has(s.id))
  }, [sessions, liveIds, archiveView, teamIds, continues])
  const sections = useMemo(() => buildSections(savedRows, states, now, '', archiveView, groupBy, watcherIds, dependabotIds), [savedRows, states, now, archiveView, groupBy, watcherIds, dependabotIds])
  const archived = useMemo(() => (sessions ?? []).filter((s) => states[s.id]?.archivedAt).length, [sessions, states])
  const shownOf = useCallback((sec: Section<SessionInfo>) => (more.has(sec.key) || sec.items.length <= CAP ? sec.items : sec.items.slice(0, CAP)), [more])
  const order = useMemo(() => sections.flatMap((sec) => (sec.fold && !open.has(sec.key) ? [] : shownOf(sec).map((s) => s.id))), [sections, open, shownOf])
  const ids = useMemo(() => order.filter((id) => picked.has(id)), [order, picked])
  const byId = useMemo(() => new Map((sessions ?? []).map((s) => [s.id, s])), [sessions])

  const clearPicked = () => { setPicked(new Set()); setSnoozing(false) }
  useEscape((e) => {
    if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return false
    clearPicked()
  }, picked.size > 0)
  const apply = (fn: (id: string) => void) => { ids.forEach(fn); clearPicked() }
  // closing or archiving deletes the worktrees a thread made: ask first when there are any
  const doRetire = (kind: Retiring['kind'], targets: string[]) => {
    targets.forEach((id) => (kind === 'close' ? close(id, true) : archive(id, true)))
    clearPicked()
    const n = targets.length === 1 ? (byId.get(targets[0])?.title ?? 'the thread') : `${targets.length} threads`
    offerUndo(`${kind === 'close' ? 'Closed' : 'Archived'} ${n}`, () => targets.forEach((id) => (kind === 'close' ? close(id, false) : archive(id, false))))
  }
  const retire = async (kind: Retiring['kind'], targets: string[]) => {
    const titleOf = (id: string) => byId.get(id)?.title ?? id
    const per = await Promise.all(targets.map((id) => window.api.worktreeLinks(id).then((links) => links.map((l) => ({ thread: titleOf(id), repo: l.repo, branch: l.branch, path: l.path }))).catch(() => [])))
    const trees = per.flat()
    if (trees.length) setRetiring({ kind, ids: targets, trees }); else doRetire(kind, targets)
  }
  const openMenu = (id: string, x: number, y: number) => {
    const targets = menuTargets(ids, id)
    if (targets !== ids) clearPicked()
    setMenu({ ids: targets, x, y })
  }
  const openSaved = (s: SessionInfo, beside = false) => { clearSnooze(s.id); openSession(s, { beside }) }
  const onSavedClick = (e: React.MouseEvent, s: SessionInfo) => {
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl && !e.shiftKey) { anchor.current = s.id; openSaved(s); return }
    const next = clickRow(order, { selected: new Set(ids), anchor: anchor.current }, s.id, { ctrl, shift: e.shiftKey })
    anchor.current = next.anchor
    setPicked(next.selected)
  }

  const isOn = (id: string, sessionId?: string) => !!focus && (focus === id || focus === sessionId)
  const isShown = (id: string, sessionId?: string) => shown.has(id) || (!!sessionId && shown.has(sessionId))

  // a live row: title and age; its state word and what it is doing now
  const liveRow = (r: LiveRow, opts: { kind?: string; who?: RosterPerson; member?: boolean } = {}) => {
    const look = liveLook(r)
    const w = watcherFor(r)
    const kind = opts.who ? opts.who.role : opts.kind ?? (w ? 'watcher' : isBot(r) ? 'dependabot' : r.kind === 'deploy' ? 'deploy' : r.kind === 'script' ? 'script' : bgIds.has(r.id) ? 'background' : '')
    const title = w?.name ?? r.title
    return (
      <div key={`l:${r.id}`} className={`rail-row${isOn(r.id, r.sessionId) ? ' on' : ''}${isShown(r.id, r.sessionId) ? ' vis' : ''}${opts.member ? ' member' : ''}`} role="button" tabIndex={0} title={title}
        onClick={() => activate(r.id)}
        onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter') { e.preventDefault(); activate(r.id) } else if (e.key === ' ' && !r.kind) { e.preventDefault(); openBeside(r.id) } }}
        data-testid="live-row" data-id={r.id}>
        <div className="rail-l1"><span className="rail-t"><span className="tt">{title}</span>{kind && <span className="rail-kd">{kind}</span>}</span><span className="rail-age">{r.since ? age(r.since, now) : ''}</span></div>
        <div className="rail-l2"><State word={look.word} tone={look.tone} /><span className="rail-now">{noteOf(r)}</span></div>
        {!r.kind && <button className="more" aria-label="Close thread" title="Close (stops it)" onClick={(e) => { e.stopPropagation(); closeSession(r.id) }} data-testid={`thread-live-close-${r.id}`}>×</button>}
      </div>
    )
  }

  // a saved row: title and age; IDLE (or the watcher's next run) and the project
  const savedRow = (s: SessionInfo, section: string, who?: RosterPerson, member = false) => {
    const st = states[s.id]
    const w = watcherOf.get(s.id)
    const resumeAt = continues.get(s.id)
    const second: [string, Tone, string] = resumeAt ? ['PAUSED', 'hold', `Usage limit. Continues at ${clock(resumeAt)}`]
      : w ? ['IDLE', 'idle', nextRunLabel(w, now) || s.project]
      : section === 'snoozed' && st?.snoozedUntil ? ['SNOOZED', 'hold', `until ${untilLabel(st.snoozedUntil, now)}`]
        : section === 'returned' ? ['BACK', 'wait', 'back from snooze']
          : st?.archivedAt ? ['ARCHIVED', 'idle', s.project] : st?.closedAt ? ['CLOSED', 'idle', s.project]
            : ['IDLE', 'idle', s.project]
    const kind = who ? who.role : w ? 'watcher' : s.dependabot ? 'dependabot' : st?.pinned ? 'pinned' : ''
    return (
      <div key={`s:${s.id}`} className={`rail-row${isOn(s.id, s.id) ? ' on' : ''}${isShown(s.id) ? ' vis' : ''}${picked.has(s.id) ? ' picked' : ''}${member ? ' member' : ''}`} role="button" tabIndex={0} title={s.title}
        onClick={(e) => onSavedClick(e, s)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter') { e.preventDefault(); openSaved(s) }
          else if (e.key === ' ') { e.preventDefault(); openSaved(s, true) }
          else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openMenu(s.id, r.left + 24, r.bottom) }
        }}
        onContextMenu={(e) => { e.preventDefault(); openMenu(s.id, e.clientX, e.clientY) }}
        data-testid="thread-row" data-id={s.id}>
        <div className="rail-l1"><span className="rail-t"><span className="tt">{s.title}</span>{kind && <span className="rail-kd">{kind}</span>}</span><span className="rail-age">{age(s.updated, now)}</span></div>
        <div className="rail-l2"><State word={second[0]} tone={second[1]} /><span className="rail-now">{second[2]}</span></div>
        <button className="more" aria-label="Thread actions" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(s.id, r.left, r.bottom) }} data-testid="thread-actions">⋯</button>
      </div>
    )
  }

  const head = (key: string, label: ReactNode, n: number | string, cls = '', fold?: { folded: boolean }) => fold
    ? <button className={`rail-gh ${cls}`} onClick={() => toggle(key)} aria-expanded={!fold.folded} data-testid="section-fold"><span>{fold.folded ? '+ ' : ''}{label}</span><span className="n">{n}</span></button>
    : <div className={`rail-gh ${cls}`}><span>{label}</span><span className="n">{n}</span></div>

  // teams: the lead's row (its state, how many work) with members folded under it; a folded team says who waits
  const teamBlock = (g: (typeof teams)[number]) => {
    const key = `team:${g.roster.id}`
    const folded = !open.has(key)
    const waiting = g.rows.filter((x) => x.kind === 'live' && x.row.state === 'waiting').length
    const lead = g.rows.find((x) => x.person.role === 'lead')
    const tone: Tone = g.word === 'PAUSED' ? 'hold' : g.word === 'WORKING' ? 'work' : 'idle'
    const openLead = () => { if (lead?.kind === 'live') activate(lead.row.id); else if (lead?.kind === 'saved') openSaved(lead.s) }
    return (
      <div key={key} data-testid="team-group" data-id={g.roster.id}>
        <div className="rail-row" role="button" tabIndex={0} title={g.roster.name} onClick={openLead}
          onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter') { e.preventDefault(); openLead() } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); toggle(key) } }} data-testid="team-row">
          <div className="rail-l1"><span className="rail-t"><span className="tt">{g.roster.name}</span><span className="rail-kd">lead</span></span>
            <button className="rail-age" style={{ background: 'none', border: 0, cursor: 'pointer' }} aria-label={folded ? 'Show members' : 'Hide members'} onClick={(e) => { e.stopPropagation(); toggle(key) }} data-testid="team-fold">{folded ? `+${g.total}` : 'hide'}</button></div>
          <div className="rail-l2">{folded && waiting ? <State word={`${waiting} WAITING`} tone="wait" /> : <State word={g.word} tone={tone} />}<span className="rail-now">Team of {g.total}, {g.working} working</span></div>
        </div>
        {!folded && g.rows.filter((x) => x.person.role !== 'lead').map((x) => (x.kind === 'live' ? liveRow(x.row, { who: x.person, member: true }) : savedRow(x.s, 'team', x.person, true)))}
      </div>
    )
  }
  const teamsWaiting = teams.filter((g) => g.rows.some((x) => x.kind === 'live' && x.row.state === 'waiting'))
  const teamsWorking = teams.filter((g) => !teamsWaiting.includes(g) && g.working > 0)
  const teamsIdle = teams.filter((g) => !teamsWaiting.includes(g) && !teamsWorking.includes(g))

  const recentSecs = sections.filter((s) => s.key !== 'archived')
  const recentCount = recentSecs.reduce((n, s) => n + s.items.length, 0) + teamsIdle.length
  return (
    <div className="rail-list" ref={box} onKeyDown={rowKeys}>
      {ids.length > 0 && (
        <div className="rail-bulk" data-testid="bulk">
          <span className="n">{ids.length} selected</span>
          {flagActions(states, ids, 'pinned').map((a) => <button key={a.label} onClick={() => apply((id) => pin(id, a.on))} data-testid="bulk-pin">{a.label}</button>)}
          <button onClick={() => setSnoozing(!snoozing)} data-testid="bulk-snooze">Snooze</button>
          {flagActions(states, ids, 'closedAt').map((a) => <button key={a.label} onClick={() => (a.on ? void retire('close', ids) : apply((id) => close(id, false)))} data-testid="bulk-close">{a.label}</button>)}
          {flagActions(states, ids, 'archivedAt').map((a) => <button key={a.label} onClick={() => (a.on ? void retire('archive', ids) : apply((id) => archive(id, false)))} data-testid="bulk-archive">{a.label}</button>)}
          <button onClick={() => setPicked(new Set(order))} data-testid="bulk-all">Select all</button>
          <button onClick={clearPicked} data-testid="bulk-clear">Clear</button>
          {snoozing && <div style={{ width: '100%', display: 'flex', gap: 12 }}>{PRESETS.map((p) => <button key={p.id} onClick={() => { const t = presetTime(p.id, Date.now()); const these = ids; apply((id) => snooze(id, t)); offerUndo(`Snoozed ${these.length} threads`, () => these.forEach(clearSnooze)) }} data-testid={`bulk-snooze-${p.id}`}>{p.label}</button>)}</div>}
        </div>
      )}
      {archiveView ? (
        <div data-testid="section-archived">
          <button className="rail-more" onClick={() => setArchiveView(false)} data-testid="archive-view">Back to threads</button>
          {head('archived', 'Archived', archived)}
          {(sections[0]?.items ?? []).map((s) => savedRow(s, 'archived'))}
        </div>
      ) : (<>
        {(waitingRows.length > 0 || teamsWaiting.length > 0) && (
          <div data-testid="section-waiting">
            {head('waiting', 'Needs you', waitingRows.length + teamsWaiting.length, 'needs')}
            {waitingRows.map((r) => liveRow(r))}
            {teamsWaiting.map(teamBlock)}
          </div>
        )}
        {(workingRows.length > 0 || teamsWorking.length > 0 || pausedRows.length > 0) && (
          <div data-testid="section-working">
            {head('working', 'Working', workingRows.length + teamsWorking.length + pausedRows.length)}
            {workingRows.map((r) => liveRow(r))}
            {teamsWorking.map(teamBlock)}
            {pausedRows.map((s) => savedRow(s, 'paused'))}
          </div>
        )}
        <div data-testid="section-recent">
          <div className="rail-gh"><span>Recent</span>
            <span className="rail-head" style={{ padding: 0, gap: 8, display: 'flex' }}>
              <button className={groupBy === 'date' ? 'on' : ''} onClick={() => setGroupBy('date')} aria-pressed={groupBy === 'date'} data-testid="threads-group-date">date</button>
              <button className={groupBy === 'project' ? 'on' : ''} onClick={() => setGroupBy('project')} aria-pressed={groupBy === 'project'} data-testid="threads-group-project">project</button>
              <span className="n">{recentCount}</span>
            </span>
          </div>
          {!sessions && <div className="rail-sub">Reading threads</div>}
          {teamsIdle.map(teamBlock)}
          {recentSecs.map((sec) => {
            const folded = !!sec.fold && !open.has(sec.key)
            const items = shownOf(sec)
            const sub = sec.key === 'watchers' || sec.key === 'pinned' ? null : sec.label
            return (
              <div key={sec.key} data-testid={`section-${sec.key}`}>
                {sec.fold ? head(sec.key, sec.label, sec.items.length, '', { folded }) : sub && <div className="rail-sub"><span>{sub}</span><span>{sec.items.length}</span></div>}
                {!folded && items.map((s) => savedRow(s, sec.sub ?? sec.key, past.get(s.id)))}
                {!folded && items.length < sec.items.length && <button className="rail-more" onClick={() => setMore((m) => new Set(m).add(sec.key))} data-testid={`section-more-${sec.key}`}>Show {sec.items.length - items.length} more</button>}
              </div>
            )
          })}
          {sessions && !recentCount && <div className="rail-sub">No saved threads yet.</div>}
          {archived > 0 && <button className="rail-more" onClick={() => setArchiveView(true)} data-testid="archive-view">Archived ({archived})</button>}
        </div>
      </>)}
      {menu && <ThreadMenu ids={menu.ids} states={states} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onDone={clearPicked} onRetire={(kind, targets) => void retire(kind, targets)} />}
      {retiring && (
        <Confirm
          title={`${retiring.kind === 'close' ? 'Close' : 'Archive'} ${retiring.ids.length === 1 ? 'this thread' : `${retiring.ids.length} threads`} and delete ${retiring.trees.length === 1 ? 'its worktree' : `${retiring.trees.length} worktrees`}?`}
          action={`${retiring.kind === 'close' ? 'Close' : 'Archive'} and delete`} danger testid="retire-confirm"
          onCancel={() => setRetiring(null)} onConfirm={() => { const r = retiring; setRetiring(null); doRetire(r.kind, r.ids) }}>
          <div>{retiring.kind === 'close' ? 'Closing' : 'Archiving'} a thread deletes the worktrees it made. Work in them that is not committed and pushed can be lost, and reopening the thread does not bring them back.</div>
          <div className="confirm-list" data-testid="retire-worktrees">
            {retiring.trees.map((t) => <div key={t.path} title={`${t.path}\nthread: ${t.thread}`}>{t.repo} on {t.branch} ({t.thread})</div>)}
          </div>
        </Confirm>
      )}
    </div>
  )
})
