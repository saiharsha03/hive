// The workbench frame, laid out the way a code editor does it: a narrow bar of icons down the left, one icon per
// section. Files, Threads and Git are side bar sections: a side bar beside the tabs they open (files, threads, diffs).
// Every other section (Codex, Environments, Allow IP, Deploy, Notes, To do, Watchers, Quarry) is a whole page of its own: it takes
// the window, and going to another section puts it away. The account and Settings sit at the bottom of the bar.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createStore, useStore } from './store'
import { getPref, setPref } from './prefs'
import { setLayout, useAppearance } from './appearance'
import { live as liveStore, newSession, openStackLog, openFileTab, openPage, showDiffBeside, talkAbout } from './actions'
import { Rail } from './Rail'
import { Files, useInspected } from './Inspector'
import { GitPanel } from './GitPanel'
import { NotesPanel } from './NotesPanel'
import { DevPanel } from './DevPanel'
import { useDev } from './useDev'
import { QuarryPage, useQuarry } from './pages/QuarryPage'
import { TodoPanel } from './TodoPanel'
import { useTodos } from './useTodos'
import { AllowBody, allowOut, useAllow } from './StatusLine'
import { DeploysPage } from './pages/DeploysPage'
import { WatchersPage } from './pages/WatchersPage'
import type { useDeploy } from './useDeploy'
import type { ToolTab } from './chat'
import { Boundary, Btn } from './kit'
import { BrandIcon } from './brandIcons'
import { AccountSwitcher } from './AccountSwitcher'
import { CodexOutput, CodexSide } from './CodexView'
import './pages/workspace.css'
import './workbench.css'

export type SideView = 'files' | 'threads' | 'codex' | 'git' | 'env' | 'allow' | 'deploy' | 'notes' | 'todo' | 'watchers' | 'quarry' | 'accounts'
const VIEWS: { id: SideView; label: string; icon: string; brand?: 'claude' | 'openai' }[] = [
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'threads', label: 'Threads', icon: 'comment-discussion', brand: 'claude' },
  { id: 'codex', label: 'Codex', icon: 'hubot', brand: 'openai' },
  { id: 'git', label: 'Git', icon: 'source-control' },
  { id: 'env', label: 'Environments', icon: 'server-environment' },
  { id: 'allow', label: 'Allow IP', icon: 'shield' },
  { id: 'deploy', label: 'Deploy', icon: 'rocket' },
  { id: 'notes', label: 'Notes', icon: 'note' },
  { id: 'todo', label: 'To do', icon: 'checklist' },
  { id: 'watchers', label: 'Watchers', icon: 'eye' },
  { id: 'quarry', label: 'Quarry', icon: 'database' },
  { id: 'accounts', label: 'Accounts', icon: 'account' },
]
const labelOf = (v: SideView) => VIEWS.find((x) => x.id === v)!.label
const isView = (v: unknown): v is SideView => VIEWS.some((x) => x.id === v)
// the side bar sections; every other section is a whole page
const SIDE: ReadonlySet<SideView> = new Set<SideView>(['files', 'threads', 'git'])
export const isFull = (v: SideView) => !SIDE.has(v)

export const sideView = createStore<SideView>((() => { const v = getPref<unknown>('side.view', 'threads'); return isView(v) ? v : 'threads' })())
/** go to a section (a side bar section also shows its side bar when that is hidden) */
export function showSide(v: SideView) { sideView.set(v); setPref('side.view', v); setLayout({ rail: true, focus: false }) }

export function ActivityBar() {
  const quarry = useQuarry() // the Quarry icon only when Quarry is installed and usable
  const { layout } = useAppearance()
  const view = useStore(sideView, (v) => v)
  const waiting = useStore(liveStore, (l) => l.waiting.length)
  const allow = useAllow()
  const open = layout.rail && !layout.focus
  const on = (v: SideView) => view === v && (open || isFull(v))
  // a whole-page section is simply shown; a side bar section hides its side bar when its icon is clicked again
  const pick = (v: SideView) => (!isFull(v) && open && v === view ? setLayout({ rail: false }) : showSide(v))
  // what an icon says beside it: threads waiting for you, an address that is not allowed yet
  const mark = (v: SideView) => (v === 'threads' && waiting > 0 ? String(waiting) : v === 'allow' && allow?.changed ? '!' : '')
  return (
    <nav className="abar" aria-label="Sections" data-testid="activity-bar">
      {VIEWS.filter((v) => v.id !== 'accounts' && (v.id !== 'quarry' || quarry?.available)).map((v) => (
        <button key={v.id} className={`abar-item${on(v.id) ? ' on' : ''}`} onClick={() => pick(v.id)} title={v.label} aria-label={v.label} aria-pressed={on(v.id)} data-testid={`abar-${v.id}`}>
          {v.brand ? <BrandIcon name={v.brand} size={22} /> : <i className={`codicon codicon-${v.icon}`} aria-hidden />}
          {mark(v.id) && <span className="abar-mark">{mark(v.id)}</span>}
        </button>
      ))}
      <span className="abar-gap" />
      <button className={`abar-item${view === 'accounts' ? ' on' : ''}`} onClick={() => showSide('accounts')} title="Accounts" aria-label="Accounts" data-testid="abar-accounts"><i className="codicon codicon-account" aria-hidden /></button>
      {/* Settings opens as a tab, so it is shown in the tab area (Threads) when a whole-page section is on show */}
      <button className="abar-item" onClick={() => { openPage('settings'); if (isFull(view)) showSide('threads') }} title="Settings (Ctrl+,)" aria-label="Settings" data-testid="abar-settings"><i className="codicon codicon-settings-gear" aria-hidden /></button>
    </nav>
  )
}

// ---------- side bar sections: Files, Threads, Git ----------
const MIN_W = 220, MAX_W = 760, DEFAULT_W = 300

export function SideBar({ currentPage }: { currentPage: ToolTab | null }) {
  const view = useStore(sideView, (v) => v)
  const [width, setWidth] = useState(() => Math.max(MIN_W, Math.min(MAX_W, getPref<number>('side.width', DEFAULT_W))))
  const drag = useRef<{ x: number; w: number } | null>(null)
  useEffect(() => {
    const move = (e: MouseEvent) => { if (drag.current) setWidth(Math.max(MIN_W, Math.min(MAX_W, drag.current.w + e.clientX - drag.current.x))) }
    const up = () => { if (!drag.current) return; drag.current = null; document.body.classList.remove('side-drag'); setWidth((w) => { setPref('side.width', w); return w }) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])
  if (isFull(view)) return null
  const title = labelOf(view)
  return (
    <aside className="side" style={{ width }} data-testid="side-bar" data-view={view} aria-label={title}>
      <div className="side-head"><span>{title}</span><button className="side-hide" onClick={() => setLayout({ rail: false })} title="Hide the side bar (Ctrl+B). Its icon brings it back" aria-label="Hide the side bar" data-testid="side-hide"><i className="codicon codicon-chevron-left" aria-hidden /></button></div>
      <div className={`side-body side-${view}`}>
        <Boundary key={view} name={title}>
          {view === 'files' ? <FilesView /> : view === 'threads' ? <Rail currentPage={currentPage} /> : <div className="ws-page side-pad"><GitPanel onDiff={showDiffBeside} /></div>}
        </Boundary>
      </div>
      <div className="side-grip" onMouseDown={(e) => { drag.current = { x: e.clientX, w: width }; document.body.classList.add('side-drag'); e.preventDefault() }} onDoubleClick={() => { setWidth(DEFAULT_W); setPref('side.width', DEFAULT_W) }} title="Drag to resize. Double-click for the usual width" />
    </aside>
  )
}

function FilesView() {
  const s = useInspected()
  return <Files s={s} onOpenFile={openFileTab} />
}

// ---------- whole-page sections ----------
// One that has been opened stays mounted while another section is on show, so Quarry keeps its queries, a note keeps
// its text and a deploy keeps its place.
export function FullSections({ deploy }: { deploy: ReturnType<typeof useDeploy> }) {
  const view = useStore(sideView, (v) => v)
  const { layout } = useAppearance()
  const [seen, setSeen] = useState<SideView[]>([])
  useEffect(() => { if (isFull(view)) setSeen((s) => (s.includes(view) ? s : [...s, view])) }, [view])
  const shown = layout.focus ? null : view
  return (
    <>
      {seen.map((v) => (
        <div key={v} className={`centre full-sec full-${v}`} style={v === shown ? undefined : { display: 'none' }} data-testid={`section-${v}`}>
          <Boundary name={labelOf(v)}><FullPage view={v} deploy={deploy} /></Boundary>
        </div>
      ))}
    </>
  )
}

function FullPage({ view, deploy }: { view: SideView; deploy: ReturnType<typeof useDeploy> }): ReactNode {
  switch (view) {
    case 'quarry': return <QuarryPage />
    case 'deploy': return <DeploysPage deploy={deploy} />
    case 'watchers': return <WatchersPage />
    case 'accounts': return <Page title="Accounts"><AccountSwitcher page onClose={() => {}} /></Page>
    case 'codex': return <Page title="Codex"><CodexSide /><CodexOutput /></Page>
    case 'env': return <Page title="Environments"><EnvPage /></Page>
    case 'allow': return <Page title="Allow IP"><AllowPage /></Page>
    case 'notes': return <Page title="Notes" wide><NotesPanel /></Page>
    case 'todo': return <Page title="To do"><TodoPage /></Page>
    default: return null
  }
}

// a whole-page section's frame: its name as the heading, the content in one readable column (wide: all the width)
function Page({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="page full-page" data-testid={`page-${title.toLowerCase().replace(/ /g, '-')}`}>
      <div className={`full-col ws-page${wide ? ' wide' : ''}`}>
        <div className="page-head"><h1>{title}</h1></div>
        {children}
      </div>
    </div>
  )
}

// the dev stacks: each environment's services, the branch each runs from, Start and Shut down
function EnvPage() {
  const { state, setState } = useDev()
  return <DevPanel state={state} setState={setState} onLogs={openStackLog} />
}

// Allow my IP: the addresses, the button, and under them what the command printed the last time it ran here
function AllowPage() {
  const allow = useAllow()
  const out = useStore(allowOut, (o) => o)
  if (!allow) return <div className="side-empty">Reading this computer's address.</div>
  if (!allow.configured) return <div className="side-empty">No allowlist command is set. Add one in Settings to allow this computer's address from here.</div>
  return (
    <div className="allow-page" data-testid="allow-page">
      <AllowBody allow={allow} />
      {(out.running || out.at) && (
        <div className="allow-run">
          <div>{out.running ? 'Running your allowlist command' : <><span className={out.ok ? 'ar-ok' : 'ar-fail'}>{out.ok ? 'Allowed' : 'Failed'}</span>{out.ip ? ` ${out.ip}` : ''}{out.at ? `, ${new Date(out.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</>}</div>
          {out.output && <pre className="ar-out" data-testid="allow-output">{out.output}</pre>}
        </div>
      )}
    </div>
  )
}

function TodoPage() {
  const t = useTodos()
  return <TodoPanel todos={t.todos} today={t.today} error={t.error} reload={t.reload} onTalk={talkAbout} />
}

// ---------- nothing open in the tab area: what to start depends on the side bar section on show ----------
type Start = { title: string; text: string; action: string; testid: string }
const STARTS: Partial<Record<SideView, Start>> = {
  threads: { title: 'No thread open', text: 'Start one, or pick one from Threads.', action: 'New thread', testid: 'welcome-new' },
  files: { title: 'No file open', text: 'Pick a file from Files and it opens here. The command field finds a file by name.', action: 'Find a file', testid: 'welcome-files' },
  git: { title: 'Nothing to compare yet', text: 'Pick a repo in Git, then a changed file, and its diff opens here.', action: 'New thread', testid: 'welcome-git' },
}

export function Welcome({ onPalette }: { onPalette: () => void }) {
  const view = useStore(sideView, (v) => v)
  const s = STARTS[view] ?? STARTS.threads!
  return (
    <div className="pane-empty" data-testid="welcome" data-view={view}>
      <div className="pe-t">{s.title}</div>
      <div>{s.text}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <Btn kind="primary" onClick={view === 'files' ? onPalette : () => newSession()} testid={s.testid}>{s.action}</Btn>
        <Btn kind="plain" onClick={onPalette} testid="welcome-palette">Ctrl K</Btn>
      </div>
    </div>
  )
}
