// The inspector: the focused thread's Activity as a timeline (a time column, then a name and one mono line of what it
// is doing; actions on the hovered or focused item): what runs now and what is coming up, each kind under its own
// heading only when it has something, Earlier in this thread, and Elsewhere folded to one line with its counts. Then
// its Changes (git for its repo: stage, commit, push) and Rewind. It rests closed and opens from the thread header.
// With a page or a file focused it keeps showing the thread that was last on screen.
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { activate, diffSpec, inspectorTab, openPage, send, setPreview, showDiff, type InspectorTab } from './actions'
import { setLayout } from './appearance'
import { useAllStatus, useThreadStatus } from './statusStore'
import { panes as panesStore, sessions, shallowEq, useSessionMetas, useStore, type SessionMeta } from './store'
import type { Session } from './chat'
import { focusedTab } from './panes'
import { Btn, clock, relative } from './kit'
import { elsewhereListed, isReviewTask, shellName, taskHeading, worthListing, type Task } from '../../shared/taskCore'
import { describer, useNow } from './ThreadStatus'
import { TaskItem } from './TaskItem'
import { useComingUp } from './ComingBar'
import { taskDetail, type TaskDetail } from '../../shared/runningBarCore'
import { modelLabel } from '../../shared/statusCore'
import { counts, FILE_TOOLS } from '../../shared/diffCore'
import { hunksOf, shortPath } from './SessionView'
import { ChangesView } from './ChangesView'
import { GitPanel } from './GitPanel'
import { FileTree } from './FileTree'
import { getPref, setPref } from './prefs'

type ITab = InspectorTab
const TABS: ITab[] = ['activity', 'changes', 'rewind']

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
  if (f && !f.tool && !f.file && !f.agent) lastThread = f.id
  return f && !f.tool && !f.file && !f.agent ? f : metas.find((s) => s.id === lastThread)
}

export const Inspector = memo(function Inspector() {
  const s = useInspected()
  const stored = useStore(inspectorTab, (t) => t)
  const tab: ITab = TABS.includes(stored) ? stored : 'activity' // a tab stored by an older version (Files, Status, PR gate) is no longer here
  const setTab = (t: ITab) => { inspectorTab.set(t); setPref('inspector.tab', t) }
  const st = useThreadStatus(s?.id)
  const now = Date.now()
  const running = st.tasks.filter((t) => t.status === 'running' && worthListing(t, now)).length
  return (
    <aside className="insp" data-testid="inspector" aria-label="Inspector">
      <div className="itabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`itab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)} data-testid={`insp-${t}`}>
            {t === 'activity' ? 'Activity' : t === 'changes' ? 'Changes' : 'Rewind'}
            {t === 'activity' && running > 0 && <span className="n">{running}</span>}
          </button>
        ))}
        <button className="iclose" onClick={() => setLayout({ inspector: false })} aria-label="Close the panel" title="Close the panel" data-testid="insp-close"><i className="codicon codicon-close" aria-hidden /></button>
      </div>
      <div className="ibody">
        {tab === 'activity' && <Activity s={s} />}
        {tab === 'changes' && (s ? <Changes id={s.id} /> : <div className="iempty">Open a thread to see its changes.</div>)}
        {tab === 'rewind' && (s ? <RewindView s={s} /> : <div className="iempty">Open a thread to rewind it.</div>)}
      </div>
    </aside>
  )
})

// ---- Activity ----
function Activity({ s }: { s?: SessionMeta }) {
  const all = useAllStatus()
  const metas = useSessionMetas()
  const session = useThreadSlice(s?.id)
  const now = useNow(true)
  const st = s ? all.get(s.id) : undefined
  // Elsewhere rests folded to one line with its counts
  const [showElsewhere, setShowElsewhere] = useState(false)
  const name = useMemo(() => describer(session?.items ?? []), [session?.items])
  const tasks = (st?.tasks ?? []).map((t) => ({ ...t, title: shellName(t, name) }))
  // a quick shell command is already a row in the chat: listing it here would flash a heading for a second
  const runningHere = tasks.filter((t) => t.status === 'running' && worthListing(t, now))
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
  // what is coming up: the same list the thread's header shows. The thread's own wake-up is the "Wakes in" line below
  type Due = { what: string; how: string; at: string }
  const coming = useComingUp(s?.id, s?.sessionId).rows
  const dueOf = (r: (typeof coming)[number]): Due => ({ what: r.what, how: r.kind === 'wake' ? 'wake-up' : r.kind === 'continue' ? 'automatic continue' : r.how, at: r.at !== null ? clock(r.at) : '' })
  const loops = coming.filter((r) => r.kind === 'loop').map(dueOf)
  const wakeups = coming.filter((r) => r.kind !== 'loop' && !r.own).map(dueOf)
  const detailOf = (t: Task): TaskDetail | undefined => taskDetail(session?.items ?? [], t)
  const sendTo = (tab: string) => (text: string, mode?: 'steer' | 'queue') => send(tab, text, [], mode)
  // what runs now, by kind: each has its own heading with its count, drawn only when something is in it
  const isShell = (t: Task) => /bash|shell/.test(t.kind)
  const isMonitor = (t: Task) => /monitor/.test(t.kind)
  const shells = runningHere.filter(isShell)
  const monitors = runningHere.filter(isMonitor)
  const isReview = (t: Task) => isReviewTask(t, detailOf(t))
  const reviews = runningHere.filter(isReview)
  const reviewsDone = finishedHere.filter(isReview).slice(0, 4)
  const agents = runningHere.filter((t) => !isShell(t) && !isMonitor(t) && !isReview(t))
  // Claude asked its advisor and the answer has not come back yet
  const advising = (session?.items ?? []).some((it) => it.kind === 'tool' && it.name === 'advisor' && it.status === 'running')
  const advisorModel = st?.advisor ? modelLabel(st.advisor) : ''
  // what the thread is held up by right now, said in one line with a moving bar
  const waitingOn: { tone: string; text: string } | null = !s ? null
    : advising ? { tone: 'advisor', text: `Asking the advisor${advisorModel ? ` (${advisorModel})` : ''}` }
      : reviews.length ? { tone: 'review', text: `${s.busy ? 'Waiting on' : 'Running'} ${reviews.length === 1 ? `a review: ${taskHeading(reviews[0])}` : `${reviews.length} reviews`}` }
        : agents.length ? { tone: 'agent', text: `${s.busy ? 'Waiting on' : 'Running'} ${agents.length === 1 ? `a subagent: ${taskHeading(agents[0])}` : `${agents.length} subagents`}` }
          : shells.length ? { tone: 'shell', text: `${shells.length === 1 ? 'A shell command is' : `${shells.length} shell commands are`} running in the background` }
            : s.busy ? { tone: 'work', text: 'Claude is working' } : null
  const sec = (label: string, n: number, tone = '', shown = n > 0) => shown && <div className={`isec isec-k${n > 0 ? ` on k-${tone}` : ''}`}><span>{label}</span><span className="n">{n}</span></div>
  const due = (x: Due, i: number) => (
    <div key={i} className="item" tabIndex={0}><div className="tm">{x.at}</div>
      <div><div className="nm" title={x.what}>{x.what}</div><div className="ds">{x.how}</div>
        <div className="ac"><Btn kind="link" onClick={() => openPage('scheduled')}>Scheduled</Btn></div></div></div>
  )
  const elsewhere = [...all].filter(([tab]) => tab !== s?.id).flatMap(([tab, x]) => x.tasks.filter((t) => elsewhereListed(t, now)).map((t) => ({ t, tab })))
  const titleOf = (tab: string) => metas.find((m) => m.id === tab)?.title ?? tab
  const elseRunning = elsewhere.filter((x) => x.t.status === 'running').length
  const elseFailed = elsewhere.length - elseRunning
  const earlier = finishedHere.length + edits.length
  const nothing = !waitingOn && !runningHere.length && !reviewsDone.length && !wakeups.length && !loops.length && !earlier && !st?.goal && !st?.nextWake
  return (
    <div data-testid="inspector-activity">
      {!s && <div className="iempty first">No thread on screen.</div>}
      {s && nothing && <div className="iempty first" data-testid="insp-empty">Nothing running in this thread.</div>}
      {s && <>
        {waitingOn && <div className={`waiting w-${waitingOn.tone}`} data-testid="insp-waiting"><span>{waitingOn.text}</span><i aria-hidden /></div>}
        {(st?.goal || st?.nextWake) && (
          <div className="inote" data-testid="inspector-status">
            {st.goal && <div title={st.goal.condition}>Goal: {st.goal.condition}</div>}
            {st.nextWake && <div>Wakes {relative(st.nextWake)}.</div>}
          </div>
        )}
        {sec('Reviews', reviews.length, 'review', reviews.length + reviewsDone.length > 0)}
        {reviews.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} detail={detailOf(t)} send={sendTo(s.id)} />)}
        {reviewsDone.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} detail={detailOf(t)} send={sendTo(s.id)} />)}
        {advising && <div className="item"><div className="tm" /><div><div className="nm">Advisor{advisorModel ? `, ${advisorModel}` : ''}</div><div className="ds">Reading the conversation to advise Claude</div></div></div>}
        {sec('Subagents', agents.length, 'agent')}
        {agents.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} detail={detailOf(t)} send={sendTo(s.id)} />)}
        {sec('Shells', shells.length, 'shell')}
        {shells.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} detail={detailOf(t)} send={sendTo(s.id)} />)}
        {sec('Monitors', monitors.length, 'monitor')}
        {monitors.map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} detail={detailOf(t)} send={sendTo(s.id)} />)}
        {sec('Wake-ups', wakeups.length, 'wake')}
        {wakeups.map(due)}
        {sec('Loops', loops.length, 'loop')}
        {loops.map(due)}
      </>}
      {earlier > 0 && s && <>
        <div className="irule" />
        <div className="isec" data-testid="insp-finished"><span>Earlier in this thread</span></div>
        {finishedHere.filter((t) => !isReview(t)).slice(0, 6).map((t) => <TaskItem key={t.id} t={t} tabId={s.id} busy={s.busy} detail={detailOf(t)} send={sendTo(s.id)} />)}
        {edits.map((e) => (
          <div key={e.id} className="item" tabIndex={0}><div className="tm" />
            <div><div className="nm" title={e.label}>Edited {e.label}</div><div className="ds"><span className="add-t">+{e.c.add}</span> <span className="del-t">{'\u2212'}{e.c.del}</span></div>
              <div className="ac"><Btn kind="link" onClick={() => showDiff(e.spec)}>Open the diff</Btn></div></div></div>
        ))}
      </>}
      {elsewhere.length > 0 && <>
        <div className="irule" />
        <button className="ifold" onClick={() => setShowElsewhere((x) => !x)} aria-expanded={showElsewhere} data-testid="insp-elsewhere"><span>Elsewhere</span>
          <span>{[elseRunning ? `${elseRunning} running` : '', elseFailed ? `${elseFailed} failed` : ''].filter(Boolean).join(', ')}</span></button>
        {showElsewhere && elsewhere.slice(0, 12).map(({ t, tab }) => <TaskItem key={`${tab}:${t.id}`} t={t} tabId={tab} thread={titleOf(tab)} busy={false} elsewhere send={sendTo(tab)} onOpen={() => activate(tab)} />)}
      </>}
    </div>
  )
}

// ---- Rewind: everything you said in this thread, newest first; each is a point to go back to ----
function RewindView({ s }: { s: SessionMeta }) {
  const session = useThreadSlice(s.id)
  const points = useMemo(() => (session?.items ?? []).flatMap((it) => (it.kind === 'user' && it.uuid ? [{ uuid: it.uuid, text: it.text.replace(/\s+/g, ' ').trim(), at: it.at }] : [])).reverse(), [session?.items])
  if (!points.length) return <div className="iempty" style={{ paddingTop: 16 }}>Nothing to rewind to yet. Each message you send becomes a point to go back to.</div>
  return (
    <div data-testid="inspector-rewind">
      <div className="inote">Go back to before one of your messages: the files Claude changed since are put back, and the message is ready to edit.</div>
      {points.map((p) => (
        <div key={p.uuid} className="item" tabIndex={0}><div className="tm">{p.at ? clock(p.at) : ''}</div>
          <div><div className="nm rw" title={p.text}>{p.text || 'A message with only attachments'}</div>
            <div className="ac"><Btn kind="link" disabled={s.busy} onClick={() => window.dispatchEvent(new CustomEvent('hive:rewind', { detail: { tab: s.id, uuid: p.uuid } }))} testid="insp-rewind" title={s.busy ? 'Stop Claude first: a thread that is working cannot be rewound' : 'Go back to before this message'}>Rewind to before this</Btn></div></div></div>
      ))}
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
