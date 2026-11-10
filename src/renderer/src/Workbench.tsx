// The workbench frame's left side, laid out the way a code editor does it: a narrow bar of icons, and beside it one
// side bar that shows the view the icon names. Files, Threads, Git, Allow IP, Deploy, Notes and To do each have a
// view; the account and Settings sit at the bottom of the bar. Clicking the icon of the view on show hides the side
// bar, clicking any icon brings it back.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createStore, useStore } from './store'
import { getPref, setPref } from './prefs'
import { setLayout, useAppearance } from './appearance'
import { live as liveStore, openFileTab, openPage, showDiffBeside, talkAbout } from './actions'
import { Rail } from './Rail'
import { Files, useInspected } from './Inspector'
import { GitPanel } from './GitPanel'
import { NotesPanel } from './NotesPanel'
import { TodoPanel } from './TodoPanel'
import { useTodos } from './useTodos'
import { AllowBody, useAllow } from './StatusLine'
import { DeploysPage } from './pages/DeploysPage'
import type { useDeploy } from './useDeploy'
import type { ToolTab } from './chat'
import { Boundary } from './kit'
import './pages/workspace.css'
import './workbench.css'

export type SideView = 'files' | 'threads' | 'git' | 'allow' | 'deploy' | 'notes' | 'todo'
const VIEWS: { id: SideView; label: string; icon: string }[] = [
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'threads', label: 'Threads', icon: 'comment-discussion' },
  { id: 'git', label: 'Git', icon: 'source-control' },
  { id: 'allow', label: 'Allow IP', icon: 'shield' },
  { id: 'deploy', label: 'Deploy', icon: 'rocket' },
  { id: 'notes', label: 'Notes', icon: 'note' },
  { id: 'todo', label: 'To do', icon: 'checklist' },
]
const isView = (v: unknown): v is SideView => VIEWS.some((x) => x.id === v)

export const sideView = createStore<SideView>((() => { const v = getPref<unknown>('side.view', 'threads'); return isView(v) ? v : 'threads' })())
/** show a view in the side bar (and the side bar itself when it is hidden) */
export function showSide(v: SideView) { sideView.set(v); setPref('side.view', v); setLayout({ rail: true, focus: false }) }

export function ActivityBar({ onAccounts }: { onAccounts: () => void }) {
  const { layout } = useAppearance()
  const view = useStore(sideView, (v) => v)
  const waiting = useStore(liveStore, (l) => l.waiting.length)
  const allow = useAllow()
  const open = layout.rail && !layout.focus
  const pick = (v: SideView) => (open && v === view ? setLayout({ rail: false }) : showSide(v))
  // what an icon says beside its name: threads waiting for you, an address that is not allowed yet
  const mark = (v: SideView) => (v === 'threads' && waiting > 0 ? String(waiting) : v === 'allow' && allow?.changed ? '!' : '')
  return (
    <nav className="abar" aria-label="Views" data-testid="activity-bar">
      {VIEWS.map((v) => (
        <button key={v.id} className={`abar-item${open && view === v.id ? ' on' : ''}`} onClick={() => pick(v.id)} title={v.label} aria-label={v.label} aria-pressed={open && view === v.id} data-testid={`abar-${v.id}`}>
          <i className={`codicon codicon-${v.icon}`} aria-hidden />
          {mark(v.id) && <span className="abar-mark">{mark(v.id)}</span>}
        </button>
      ))}
      <span className="abar-gap" />
      <button className="abar-item" onClick={onAccounts} title="Accounts" aria-label="Accounts" data-testid="abar-accounts"><i className="codicon codicon-account" aria-hidden /></button>
      <button className="abar-item" onClick={() => openPage('settings')} title="Settings (Ctrl+,)" aria-label="Settings" data-testid="abar-settings"><i className="codicon codicon-settings-gear" aria-hidden /></button>
    </nav>
  )
}

const MIN_W = 220, MAX_W = 760, DEFAULT_W = 300

export function SideBar({ currentPage, deploy }: { currentPage: ToolTab | null; deploy: ReturnType<typeof useDeploy> }) {
  const view = useStore(sideView, (v) => v)
  const [width, setWidth] = useState(() => Math.max(MIN_W, Math.min(MAX_W, getPref<number>('side.width', DEFAULT_W))))
  const drag = useRef<{ x: number; w: number } | null>(null)
  useEffect(() => {
    const move = (e: MouseEvent) => { if (drag.current) setWidth(Math.max(MIN_W, Math.min(MAX_W, drag.current.w + e.clientX - drag.current.x))) }
    const up = () => { if (!drag.current) return; drag.current = null; document.body.classList.remove('side-drag'); setWidth((w) => { setPref('side.width', w); return w }) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])
  const title = VIEWS.find((v) => v.id === view)!.label
  return (
    <aside className="side" style={{ width }} data-testid="side-bar" data-view={view} aria-label={title}>
      <div className="side-head">{title}</div>
      <div className={`side-body side-${view}`}>
        <Boundary key={view} name={title}><SideViewBody view={view} currentPage={currentPage} deploy={deploy} /></Boundary>
      </div>
      <div className="side-grip" onMouseDown={(e) => { drag.current = { x: e.clientX, w: width }; document.body.classList.add('side-drag'); e.preventDefault() }} onDoubleClick={() => { setWidth(DEFAULT_W); setPref('side.width', DEFAULT_W) }} title="Drag to resize. Double-click for the usual width" />
    </aside>
  )
}

function SideViewBody({ view, currentPage, deploy }: { view: SideView; currentPage: ToolTab | null; deploy: ReturnType<typeof useDeploy> }): ReactNode {
  switch (view) {
    case 'files': return <FilesView />
    case 'threads': return <Rail currentPage={currentPage} />
    case 'git': return <div className="ws-page side-pad"><GitPanel onDiff={showDiffBeside} /></div>
    case 'allow': return <AllowView />
    case 'deploy': return <DeploysPage deploy={deploy} />
    case 'notes': return <div className="ws-page side-pad"><NotesPanel /></div>
    case 'todo': return <TodoView />
  }
}

function FilesView() {
  const s = useInspected()
  return <Files s={s} onOpenFile={openFileTab} />
}

function AllowView() {
  const allow = useAllow()
  if (!allow) return <div className="side-empty">Reading this computer's address.</div>
  if (!allow.configured) return <div className="side-empty">No allowlist command is set. Add one in Settings to allow this computer's address from here.</div>
  return <div className="side-allow" data-testid="side-allow"><AllowBody allow={allow} /></div>
}

function TodoView() {
  const t = useTodos()
  return <div className="ws-page side-pad"><TodoPanel todos={t.todos} today={t.today} error={t.error} reload={t.reload} onTalk={talkAbout} /></div>
}
