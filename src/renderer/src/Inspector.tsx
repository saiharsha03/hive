// The inspector: the focused thread's Activity (what runs in it, what is scheduled for it, what finished, and what
// runs elsewhere), its Changes (git for its repo: stage, commit, push), its Files (tree with git colours) and a short
// Status. With a page or a file focused it keeps showing the thread that was last on screen.
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { activate, diffSpec, inspectorTab, openPage, send, setPreview, showDiff, type InspectorTab } from './actions'
import { useAllStatus, useThreadStatus } from './statusStore'
import { panes as panesStore, sessions, shallowEq, useSessionMetas, useStore, type SessionMeta } from './store'
import type { Session } from './chat'
import { focusedTab } from './panes'
import { State, Btn, Bar, KV, dur, clock, relative, taskState, tokens as fmtTokens } from './kit'
import { shellName, kindLabel, type Task } from '../../shared/taskCore'
import { describer, useNow } from './ThreadStatus'
import { nextRun, describeCron } from '../../shared/cronCore'
import { modelLabel } from '../../shared/statusCore'
import { modeLabel } from '../../shared/modeCore'
import { counts, FILE_TOOLS } from '../../shared/diffCore'
import { hunksOf, shortPath } from './SessionView'
import { ChangesView } from './ChangesView'
import { GitPanel } from './GitPanel'
import { FileTree } from './FileTree'
import { getPref, setPref } from './prefs'
import { wakeupsList, onWakeupsChanged, type Wakeups } from './api/next'

type ITab = InspectorTab

// the parts of a thread the inspector draws: they do not change while a reply streams, so a token re-renders nothing here
type Slice = Pick<Session, 'id' | 'title' | 'items' | 'cwd' | 'worktrees' | 'sessionId' | 'busy' | 'background' | 'loaded' | 'streaming'>
function useThreadSlice(id: string | undefined): Session | undefined {
  const sel = useCallback((all: Session[]): Slice | undefined => {
    const s = id ? all.find((x) => x.id === id) : undefined
    return s && { id: s.id, title: s.title, items: s.items, cwd: s.cwd, worktrees: s.worktrees, sessionId: s.sessionId, busy: s.busy, background: s.background, loaded: s.loaded, streaming: '' }
  }, [id])
  return useStore(sessions, sel, shallowEq) as Session | undefined
}
inspectorTab.set(getPref<ITab>('inspector.tab', 'activity'))

// the thread the inspector follows: the focused tab when it is a thread, else the last thread that was
let lastThread: string | null = null
function useInspected(): SessionMeta | undefined {
  const metas = useSessionMetas()
  const focus = useStore(panesStore, focusedTab)
  const f = metas.find((s) => s.id === focus)
  if (f && !f.tool && !f.file) lastThread = f.id
  return f && !f.tool && !f.file ? f : metas.find((s) => s.id === lastThread)
}

export const Inspector = memo(function Inspector() {
  const s = useInspected()
  const tab = useStore(inspectorTab, (t) => t)
  const setTab = (t: ITab) => { inspectorTab.set(t); setPref('inspector.tab', t) }
  const st = useThreadStatus(s?.id)
  const running = st.tasks.filter((t) => t.status === 'running').length
  return (
    <aside className="insp" data-testid="inspector" aria-label="Inspector">
      <div className="itabs" role="tablist">
        {(['activity', 'changes', 'files', 'status'] as ITab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`itab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)} data-testid={`insp-${t}`}>
            {t === 'activity' ? 'Activity' : t === 'changes' ? 'Changes' : t === 'files' ? 'Files' : 'Status'}
            {t === 'activity' && running > 0 && <span className="n">{running}</span>}
          </button>
        ))}
      </div>
      <div className="ibody">
        {tab === 'activity' && <Activity s={s} />}
        {tab === 'changes' && (s ? <Changes id={s.id} /> : <div className="iempty">Open a thread to see its changes.</div>)}
        {tab === 'files' && <Files s={s} />}
        {tab === 'status' && (s ? <MiniStatus s={s} /> : <div className="iempty">Open a thread to see its status.</div>)}
      </div>
    </aside>
  )
})

// ---- Activity ----
function TaskItem({ t, tabId, thread, busy, elsewhere }: { t: Task; tabId: string; thread?: string; busy: boolean; elsewhere?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const now = Date.now()
  const w = taskState(t.status)
  const last = t.now || t.lastTool || t.summary || t.error || ''
  const isAgent = /agent/.test(t.kind)
  const go = () => {
    const v = (msg ?? '').trim()
    if (!v) return
    send(tabId, `[To subagent "${t.name ? `${t.name}: ` : ''}${t.title}" (task ${t.id})] ${v}`, [], busy ? 'steer' : undefined)
    setMsg(null)
  }
  return (
    <div className={`item${open ? ' open' : ''}`} tabIndex={0} data-testid="activity-item">
      <div className="i1"><State word={w.word} tone={w.tone} /><span className="n" title={t.title}>{elsewhere ? `${t.title} in ${thread}` : `${kindLabel(t.kind)}: ${t.title}`}</span>
        <span className="d">{t.status === 'running' ? dur(now - t.startedAt) : clock(t.endedAt ?? t.startedAt)}</span></div>
      {last && <div className="i2" title={last}>{last}</div>}
      {msg !== null && (
        <div className="i3"><input className="uline" style={{ flex: 1 }} autoFocus value={msg} placeholder="Message this subagent (Claude passes it on)" onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMsg(null) } }} data-testid={`agent-chat-${t.id}`} /></div>
      )}
      <div className="i3">
        {t.status === 'running' && isAgent && msg === null && <Btn kind="link" onClick={() => setMsg('')}>Message</Btn>}
        <Btn kind="link" onClick={() => (elsewhere ? activate(tabId) : setOpen(!open))}>{elsewhere ? 'Open' : open ? 'Less' : 'Output'}</Btn>
        {t.status === 'running' && <Btn kind="link" className="x" onClick={() => void window.api.chatStopTask(tabId, t.id)} testid={`task-stop-${t.id}`}>Stop</Btn>}
        {elsewhere && t.status === 'failed' && <Btn kind="link" onClick={() => send(tabId, `Retry the task that failed: ${t.title}`, [], busy ? 'queue' : undefined)}>Retry</Btn>}
      </div>
      {open && (t.agents.length > 0 || t.error) && <div className="i2">{[t.error, ...t.agents.map((a) => `${a.label}: ${a.state}${a.result ? `, ${a.result}` : ''}`)].filter(Boolean).join('\n')}</div>}
    </div>
  )
}

function Activity({ s }: { s?: SessionMeta }) {
  const all = useAllStatus()
  const metas = useSessionMetas()
  const session = useThreadSlice(s?.id)
  const now = useNow(true)
  const st = s ? all.get(s.id) : undefined
  // Finished and Elsewhere rest folded, with their counts
  const [showFinished, setShowFinished] = useState(false)
  const [showElsewhere, setShowElsewhere] = useState(false)
  const name = useMemo(() => describer(session?.items ?? []), [session?.items])
  const tasks = (st?.tasks ?? []).map((t) => ({ ...t, title: shellName(t, name) }))
  const runningHere = tasks.filter((t) => t.status === 'running')
  const today = new Date().setHours(0, 0, 0, 0)
  const finishedHere = tasks.filter((t) => t.status !== 'running' && (t.endedAt ?? 0) >= today).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  // this thread's edits as finished rows ("Edit billing/invoice.py +31 -8, open the diff")
  const edits = useMemo(() => (session?.items ?? []).flatMap((it) => {
    if (it.kind !== 'tool' || !FILE_TOOLS.includes(it.name) || it.status !== 'done' || typeof it.input?.file_path !== 'string') return []
    const h = hunksOf(it)
    const c = counts(h)
    const label = shortPath(it.input.file_path, session?.cwd)
    return [{ id: it.id, label, c, spec: { t: 'edit' as const, file: it.input.file_path as string, label, tool: it.name, hunks: h } }]
  }).slice(-6).reverse(), [session?.items, session?.cwd])
  const [wakes, setWakes] = useState<Wakeups | null>(null)
  useEffect(() => {
    const load = () => void wakeupsList().then((r) => setWakes(r.ok ? r.data : null))
    load()
    return onWakeupsChanged(load)
  }, [])
  const schedule: { word: string; tone: 'work' | 'hold' | 'accent' | 'idle'; what: string; at: string }[] = []
  for (const j of st?.crons ?? []) { const n = nextRun(j.schedule, new Date(now)); schedule.push({ word: 'LOOP', tone: 'work', what: `${describeCron(j.schedule)}: ${j.prompt}`, at: n ? clock(n) : '' }) }
  if (st?.nextWake) schedule.push({ word: 'WAKE-UP', tone: 'accent', what: 'Claude wakes this thread', at: clock(st.nextWake) })
  for (const w of wakes?.wakeups ?? []) if (s?.sessionId && w.sessionId === s.sessionId) schedule.push({ word: 'WAKE-UP', tone: 'accent', what: w.prompt, at: clock(Date.parse(w.wakeAt)) })
  for (const c of wakes?.continues ?? []) if (s && (c.tabId === s.id || c.key === s.sessionId)) schedule.push({ word: 'AUTO-CONTINUE', tone: 'hold', what: 'Continues after the usage limit resets', at: clock(c.at) })
  const elsewhere = [...all].filter(([tab]) => tab !== s?.id).flatMap(([tab, x]) => x.tasks.filter((t) => t.status === 'running' || (t.status === 'failed' && now - (t.endedAt ?? 0) < 3_600_000)).map((t) => ({ t, tab })))
  const titleOf = (tab: string) => metas.find((m) => m.id === tab)?.title ?? tab
  return (
    <div data-testid="inspector-activity">
      <div className="isec"><span>Running in this thread</span><span>{runningHere.length}</span></div>
      {!s ? <div className="iempty">No thread on screen.</div> : runningHere.length ? runningHere.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} />)
        : <div className="iempty">{s.busy ? 'Claude is working; nothing runs in the background.' : 'Nothing running.'}</div>}
      <div className="isec"><span>Scheduled for this thread</span><span>{schedule.length}</span></div>
      {schedule.length ? schedule.map((x, i) => (
        <div key={i} className="item" tabIndex={0}><div className="i1"><State word={x.word} tone={x.tone} /><span className="n" title={x.what}>{x.what}</span><span className="d">{x.at}</span></div>
          <div className="i3"><Btn kind="link" onClick={() => openPage('scheduled')}>Scheduled page</Btn></div></div>
      )) : <div className="iempty">Nothing scheduled.</div>}
      <button className="isec fold" onClick={() => setShowFinished((x) => !x)} aria-expanded={showFinished} data-testid="insp-finished"><span>Finished</span><span>{finishedHere.length + edits.length}</span></button>
      {showFinished && <>
      {finishedHere.map((t) => s && <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} />)}
      {edits.map((e) => (
        <div key={e.id} className="item" tabIndex={0}><div className="i1"><State word="DONE" tone="done" /><span className="n" title={e.label}>Edit {e.label}</span><span className="d" /></div>
          <div className="i2"><span className="add-t">+{e.c.add}</span> <span className="del-t">-{e.c.del}</span> <Btn kind="link" onClick={() => showDiff(e.spec)}>open the diff</Btn></div></div>
      ))}
      {!finishedHere.length && !edits.length && <div className="iempty">Nothing finished yet today.</div>}
      </>}
      <button className="isec fold" onClick={() => setShowElsewhere((x) => !x)} aria-expanded={showElsewhere} data-testid="insp-elsewhere"><span>Elsewhere</span><span>{elsewhere.length}</span></button>
      {showElsewhere && (elsewhere.length ? elsewhere.slice(0, 12).map(({ t, tab }) => <TaskItem key={`${tab}:${t.id}`} t={t} tabId={tab} thread={titleOf(tab)} busy={false} elsewhere />)
        : <div className="iempty">Nothing running in other threads.</div>)}
    </div>
  )
}

// ---- Changes: the thread's changed files, then its repo's git (stage, commit, push) ----
function Changes({ id }: { id: string }) {
  const session = useThreadSlice(id)
  const shownDiff = useStore(diffSpec, (d) => d)
  const [focus, setFocus] = useState<{ dir: string; n: number } | null>(null)
  // the Git part opens on this thread's repository (its newest worktree, else its folder)
  const dir = session?.worktrees?.at(-1)?.path ?? session?.cwd
  useEffect(() => {
    let alive = true
    if (dir) void window.api.gitLocate(`${dir}/.`).then((at) => { if (alive && at) setFocus({ dir: at.dir, n: Date.now() }) }).catch(() => {})
    return () => { alive = false }
  }, [dir])
  if (!session) return null
  return (
    <div className="ichanges" data-testid="inspector-changes">
      <ChangesView session={session} diff={shownDiff} shown onDiff={(d) => d && showDiff(d)}
        onOpenGit={() => { if (dir) void window.api.gitLocate(`${dir}/.`).then((at) => at && setFocus({ dir: at.dir, n: Date.now() })) }} />
      <div className="isec"><span>Repository</span></div>
      <div className="igit ws-page"><GitPanel onDiff={showDiff} focus={focus} /></div>
    </div>
  )
}

// ---- Files: the thread's folder (its newest worktree), git colours ----
function Files({ s }: { s?: SessionMeta }) {
  const [root, setRoot] = useState<string | null>(null)
  const own = s?.worktrees?.at(-1)?.path ?? s?.cwd ?? null
  const [home, setHome] = useState('')
  useEffect(() => { void window.api.workspaceRoot().then((r) => setHome(r ?? '')) }, [])
  const dir = root ?? own ?? home
  useEffect(() => { setRoot(null) }, [own])
  if (!dir) return <div className="iempty">No folder yet.</div>
  return <div className="ftree-wrap" data-testid="inspector-files"><FileTree root={dir} onOpenFolder={() => void window.api.pickFolder().then((f) => f && setRoot(f))} selected={null} onOpenFile={(p) => setPreview(p)} /></div>
}

// ---- Status: the thread in a few lines; the full page is one click away ----
function MiniStatus({ s }: { s: SessionMeta }) {
  const st = useThreadStatus(s.id)
  const [ctx, setCtx] = useState<{ total: number; max: number } | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => void window.api.chatContext(s.id).then((c) => { if (alive) setCtx(c) }).catch(() => {})
    load()
    const t = setInterval(load, 15_000)
    return () => { alive = false; clearInterval(t) }
  }, [s.id, s.busy])
  const pct = ctx && ctx.max ? (ctx.total / ctx.max) * 100 : null
  const wt = s.worktrees?.at(-1)
  return (
    <div style={{ padding: '6px 14px' }} data-testid="inspector-status">
      <KV rows={[
        ['Model', st.model ? `${modelLabel(st.model)}` : 'default'],
        ['Effort', st.ultrathink ? 'max for this turn' : st.effort ?? 'default'],
        ['Mode', modeLabel(s.mode ?? (s.background ? 'auto' : 'default')).replace(/ mode$/i, '').toLowerCase()],
        ['Folder', wt ? `${wt.repo} worktree on ${wt.branch}` : s.cwd ?? ''],
        ['Goal', st.goal ? `${st.goal.condition}` : 'none'],
        ['Compacted', String(s.compactions ?? 0)],
      ]} />
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--dim)', marginBottom: 4 }}>
          <span>Context</span><span className="num" style={{ color: 'var(--hi)' }}>{ctx ? `${fmtTokens(ctx.total)} of ${fmtTokens(ctx.max)}` : 'not read yet'}</span>
        </div>
        {pct !== null && <Bar pct={pct} />}
      </div>
      {st.nextWake && <div className="empty-line">Wakes {relative(st.nextWake)}.</div>}
      <div style={{ marginTop: 12 }}><Btn kind="plain" onClick={() => openPage('status')}>Status and usage</Btn></div>
    </div>
  )
}
