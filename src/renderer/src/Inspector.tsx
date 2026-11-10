// The inspector: the focused thread's Activity as a timeline (a time column, then a name and one mono line of what it
// is doing; actions on the hovered or focused item): Running now, Coming up, Earlier in this thread, and Elsewhere
// folded to one line with a count plus any failure. Then its Changes (git for its repo: stage, commit, push), its Files (tree with git colours) and a short
// Status. With a page or a file focused it keeps showing the thread that was last on screen.
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { activate, diffSpec, inspectorTab, openPage, send, setPreview, showDiff, type InspectorTab } from './actions'
import { useAllStatus, useThreadStatus } from './statusStore'
import { panes as panesStore, sessions, shallowEq, useSessionMetas, useStore, type SessionMeta } from './store'
import type { Session } from './chat'
import { focusedTab } from './panes'
import { Btn, Bar, KV, dur, clock, relative, tokens as fmtTokens } from './kit'
import { shellName, taskHeading, type Task } from '../../shared/taskCore'
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
export function useInspected(): SessionMeta | undefined {
  const metas = useSessionMetas()
  const focus = useStore(panesStore, focusedTab)
  const f = metas.find((s) => s.id === focus)
  if (f && !f.tool && !f.file) lastThread = f.id
  return f && !f.tool && !f.file ? f : metas.find((s) => s.id === lastThread)
}

export const Inspector = memo(function Inspector() {
  const s = useInspected()
  const stored = useStore(inspectorTab, (t) => t)
  const tab: ITab = stored === 'files' ? 'activity' : stored // Files lives in the side bar now
  const setTab = (t: ITab) => { inspectorTab.set(t); setPref('inspector.tab', t) }
  const st = useThreadStatus(s?.id)
  const running = st.tasks.filter((t) => t.status === 'running').length
  return (
    <aside className="insp" data-testid="inspector" aria-label="Inspector">
      <div className="itabs" role="tablist">
        {(['activity', 'changes', 'status'] as ITab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`itab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)} data-testid={`insp-${t}`}>
            {t === 'activity' ? 'Activity' : t === 'changes' ? 'Changes' : 'Status'}
            {t === 'activity' && running > 0 && <span className="n">{running}</span>}
          </button>
        ))}
      </div>
      <div className="ibody">
        {tab === 'activity' && <Activity s={s} />}
        {tab === 'changes' && (s ? <Changes id={s.id} /> : <div className="iempty">Open a thread to see its changes.</div>)}
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
  const last = t.now || t.lastTool || t.summary || t.error || ''
  const isAgent = /agent/.test(t.kind)
  const go = () => {
    const v = (msg ?? '').trim()
    if (!v) return
    send(tabId, `[To subagent "${t.name ? `${t.name}: ` : ''}${t.title}" (task ${t.id})] ${v}`, [], busy ? 'steer' : undefined)
    setMsg(null)
  }
  return (
    <div className={`item${open ? ' open' : ''}${t.status === 'failed' ? ' failed' : ''}`} tabIndex={0} data-testid="activity-item">
      <div className="tm">{t.status === 'running' ? dur(now - t.startedAt) : clock(t.endedAt ?? t.startedAt)}</div>
      <div>
        <div className="nm" title={taskHeading(t)}>{elsewhere ? `${taskHeading(t)}${t.status === 'failed' ? ' failed' : ''} in ${thread}` : taskHeading(t)}</div>
        {last && <div className="ds" title={last}>{last}</div>}
        {open && (t.agents.length > 0 || t.error) && <div className="ds">{[t.error, ...t.agents.map((a) => `${a.label}: ${a.state}${a.result ? `, ${a.result}` : ''}`)].filter(Boolean).join('\n')}</div>}
        {msg !== null && (
          <div className="ac"><input className="uline" style={{ flex: 1 }} autoFocus value={msg} placeholder="Message this subagent (Claude passes it on)" onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMsg(null) } }} data-testid={`agent-chat-${t.id}`} /></div>
        )}
        <div className="ac">
          <Btn kind="link" onClick={() => (elsewhere ? activate(tabId) : setOpen(!open))}>{elsewhere ? 'Open' : open ? 'Less' : 'Output'}</Btn>
          {t.status === 'running' && <Btn kind="link" onClick={() => void window.api.chatStopTask(tabId, t.id)} testid={`task-stop-${t.id}`}>Stop</Btn>}
          {t.status === 'running' && isAgent && msg === null && <Btn kind="link" onClick={() => setMsg('')}>Message</Btn>}
          {elsewhere && t.status === 'failed' && <Btn kind="link" onClick={() => send(tabId, `Retry the task that failed: ${t.title}`, [], busy ? 'queue' : undefined)}>Retry</Btn>}
        </div>
      </div>
    </div>
  )
}

function Activity({ s }: { s?: SessionMeta }) {
  const all = useAllStatus()
  const metas = useSessionMetas()
  const session = useThreadSlice(s?.id)
  const now = useNow(true)
  const st = s ? all.get(s.id) : undefined
  // Elsewhere rests folded to one line with its counts; a failure there stays in view
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
  type Due = { what: string; how: string; at: string }
  const loops: Due[] = []
  const wakeups: Due[] = []
  for (const j of st?.crons ?? []) { const n = nextRun(j.schedule, new Date(now)); loops.push({ what: j.prompt, how: describeCron(j.schedule), at: n ? clock(n) : '' }) }
  if (st?.nextWake) wakeups.push({ what: 'Claude wakes this thread', how: 'wake-up', at: clock(st.nextWake) })
  for (const w of wakes?.wakeups ?? []) if (s?.sessionId && w.sessionId === s.sessionId) wakeups.push({ what: w.prompt, how: 'wake-up', at: clock(Date.parse(w.wakeAt)) })
  for (const c of wakes?.continues ?? []) if (s && (c.tabId === s.id || c.key === s.sessionId)) wakeups.push({ what: 'Continues after the usage limit resets', how: 'automatic continue', at: clock(c.at) })
  // what runs now, by kind: each has its own heading, with its count, whether or not anything is in it
  const isShell = (t: Task) => /bash|shell/.test(t.kind)
  const isMonitor = (t: Task) => /monitor/.test(t.kind)
  const shells = runningHere.filter(isShell)
  const monitors = runningHere.filter(isMonitor)
  const agents = runningHere.filter((t) => !isShell(t) && !isMonitor(t))
  // the last things you said in this thread, newest first: each is a point to rewind to
  const points = useMemo(() => (session?.items ?? []).flatMap((it) => (it.kind === 'user' && it.uuid ? [{ uuid: it.uuid, text: it.text.replace(/\s+/g, ' ').trim() }] : [])).slice(-5).reverse(), [session?.items])
  const sec = (label: string, n: number) => <div className="isec isec-k"><span>{label}</span><span className="n">{n}</span></div>
  const due = (x: Due, i: number) => (
    <div key={i} className="item" tabIndex={0}><div className="tm">{x.at}</div>
      <div><div className="nm" title={x.what}>{x.what}</div><div className="ds">{x.how}</div>
        <div className="ac"><Btn kind="link" onClick={() => openPage('scheduled')}>Scheduled</Btn></div></div></div>
  )
  const elsewhere = [...all].filter(([tab]) => tab !== s?.id).flatMap(([tab, x]) => x.tasks.filter((t) => t.status === 'running' || (t.status === 'failed' && now - (t.endedAt ?? 0) < 3_600_000)).map((t) => ({ t, tab })))
  const titleOf = (tab: string) => metas.find((m) => m.id === tab)?.title ?? tab
  const elseRunning = elsewhere.filter((x) => x.t.status === 'running').length
  const elseFailed = elsewhere.filter((x) => x.t.status === 'failed')
  const earlier = finishedHere.length + edits.length
  return (
    <div data-testid="inspector-activity">
      {!s && <div className="iempty" style={{ paddingTop: 16 }}>No thread on screen.</div>}
      {s && <>
        {sec('Subagents', agents.length)}
        {agents.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} />)}
        {sec('Shells', shells.length)}
        {shells.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} />)}
        {sec('Monitors', monitors.length)}
        {monitors.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} />)}
        {sec('Wake-ups', wakeups.length)}
        {wakeups.map(due)}
        {sec('Loops', loops.length)}
        {loops.map(due)}
        {sec('Rewind', points.length)}
        {points.map((p) => (
          <div key={p.uuid} className="item" tabIndex={0}><div className="tm" />
            <div><div className="nm" title={p.text}>{p.text || 'A message with only attachments'}</div>
              <div className="ac"><Btn kind="link" onClick={() => window.dispatchEvent(new CustomEvent('hive:rewind', { detail: { tab: s.id, uuid: p.uuid } }))} testid="insp-rewind" title="Go back to before this message: put back the files Claude changed since, and edit the message">Rewind to before this</Btn></div></div></div>
        ))}
      </>}
      {earlier > 0 && s && <>
        <div className="irule" />
        <div className="isec" data-testid="insp-finished"><span>Earlier in this thread</span></div>
        {finishedHere.slice(0, 6).map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} />)}
        {edits.map((e) => (
          <div key={e.id} className="item" tabIndex={0}><div className="tm" />
            <div><div className="nm" title={e.label}>Edited {e.label}</div><div className="ds"><span className="add-t">+{e.c.add}</span> <span className="del-t">{'\u2212'}{e.c.del}</span></div>
              <div className="ac"><Btn kind="link" onClick={() => showDiff(e.spec)}>Open the diff</Btn></div></div></div>
        ))}
      </>}
      <div className="irule" />
      <button className="ifold" onClick={() => setShowElsewhere((x) => !x)} aria-expanded={showElsewhere} data-testid="insp-elsewhere"><span>Elsewhere</span>
        <span>{elsewhere.length ? [elseRunning ? `${elseRunning} running` : '', elseFailed.length ? `${elseFailed.length} failed` : ''].filter(Boolean).join(', ') : 'nothing running'}</span></button>
      {showElsewhere
        ? elsewhere.slice(0, 12).map(({ t, tab }) => <TaskItem key={`${tab}:${t.id}`} t={t} tabId={tab} thread={titleOf(tab)} busy={false} elsewhere />)
        : elseFailed.map(({ t, tab }) => <TaskItem key={`${tab}:${t.id}`} t={t} tabId={tab} thread={titleOf(tab)} busy={false} elsewhere />)}
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

// ---- Files: its own browser, not tied to the thread. It opens on the workspace folder (or the folder picked last, which
// is remembered) and stays there when the focused thread changes; "Thread folder" jumps to the thread's own checkout ----
export function Files({ s, onOpenFile = setPreview }: { s?: SessionMeta; onOpenFile?: (p: string) => void }) {
  const [root, setRootState] = useState<string | null>(() => getPref<string | null>('filesRoot', null))
  const setRoot = (f: string | null) => { setRootState(f); setPref('filesRoot', f) }
  const own = s?.worktrees?.at(-1)?.path ?? s?.cwd ?? null
  const [home, setHome] = useState('')
  useEffect(() => { void window.api.workspaceRoot().then((r) => setHome(r ?? '')) }, [])
  const dir = root ?? (home || own)
  if (!dir) return <div className="iempty">No folder yet.</div>
  const norm = (x: string) => x.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  const same = (a: string, b: string) => norm(a) === norm(b)
  return (
    <div className="ftree-wrap" data-testid="inspector-files">
      <div className="ftree-jump">
        {home && !same(dir, home) && <button className="btn-link" onClick={() => setRoot(null)} data-testid="files-workspace">Workspace</button>}
        {own && !same(dir, own) && <button className="btn-link" onClick={() => setRoot(own)} title={own} data-testid="files-thread">Thread folder</button>}
      </div>
      <FileTree root={dir} onOpenFolder={() => void window.api.pickFolder().then((f) => f && setRoot(f))} selected={null} onOpenFile={(p) => onOpenFile(p)} />
    </div>
  )
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
    <div style={{ padding: '14px 22px' }} data-testid="inspector-status">
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
          <span>Context</span><span className="num" style={{ color: 'var(--hi)' }}>{ctx ? `${fmtTokens(ctx.total)}${ctx.max ? ` of ${fmtTokens(ctx.max)}` : ''}` : 'not read yet'}</span>
        </div>
        {pct !== null && <Bar pct={pct} />}
      </div>
      {st.nextWake && <div className="empty-line">Wakes {relative(st.nextWake)}.</div>}
      <div style={{ marginTop: 12 }}><Btn kind="plain" onClick={() => openPage('status')}>Status and usage</Btn></div>
    </div>
  )
}
