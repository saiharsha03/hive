// The workbench frame: a slim rail of labelled destinations down the left (Threads, Running, Scheduled, Files, and More
// for every other section), Terminal and Settings at its foot. Files, Threads and Git are side bar sections: a side bar
// beside the tabs they open (files, threads, diffs). Every other section is a whole page: it takes the tab area, the
// thread list stays beside it, and going to another section puts it away.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { createStore, useStore } from './store'
import { getPref, setPref } from './prefs'
import { setLayout, useAppearance } from './appearance'
import { live as liveStore, newSession, openStackLog, openFileTab, openPage, sectionRoute, showDiffBeside, talkAbout, toggleTerminal } from './actions'
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
import { RunningPage } from './pages/RunningPage'
import { ScheduledPage } from './pages/ScheduledPage'
import { StatusPage } from './pages/StatusPage'
import { BoardPage } from './pages/BoardPage'
import { DependabotTab, PullTab, ScriptsTab } from './pages/WorkspacePage'
import type { useDeploy } from './useDeploy'
import type { ToolTab } from './chat'
import { Boundary, Btn, Keys } from './kit'
import { Popover, useMenuKeys, type Anchor } from './ui'
import { BrandIcon } from './brandIcons'
import { AccountSwitcher } from './AccountSwitcher'
import { LimitGauges } from './LimitGauges'
import { CodexOutput, CodexSide } from './CodexView'
import './pages/workspace.css'
import './workbench.css'

export type SideView = 'files' | 'threads' | 'codex' | 'git' | 'env' | 'allow' | 'deploy' | 'notes' | 'todo' | 'watchers' | 'running' | 'scheduled' | 'pull' | 'scripts' | 'dependabot' | 'usage' | 'board' | 'quarry' | 'accounts'
export const VIEWS: { id: SideView; label: string; icon: string; brand?: 'claude' | 'openai' }[] = [
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
  { id: 'running', label: 'Running', icon: 'pulse' },
  { id: 'scheduled', label: 'Scheduled', icon: 'clock' },
  { id: 'pull', label: 'Pull', icon: 'repo-pull' },
  { id: 'scripts', label: 'Scripts', icon: 'play' },
  { id: 'dependabot', label: 'Dependabot', icon: 'package' },
  { id: 'usage', label: 'Usage', icon: 'graph' },
  { id: 'board', label: 'Board', icon: 'project' },
  { id: 'quarry', label: 'Quarry', icon: 'database' },
  { id: 'accounts', label: 'Accounts', icon: 'account' },
]
const labelOf = (v: SideView) => VIEWS.find((x) => x.id === v)!.label
const isView = (v: unknown): v is SideView => VIEWS.some((x) => x.id === v)
// the side bar sections; every other section is a whole page
const SIDE: ReadonlySet<SideView> = new Set<SideView>(['files', 'threads', 'git'])
export const isFull = (v: SideView) => !SIDE.has(v)

export const sideView = createStore<SideView>((() => { const v = getPref<unknown>('side.view', 'threads'); return isView(v) ? v : 'threads' })())
/** go to a section. A side bar section also shows its side bar when that is hidden; a whole page leaves it as it is */
export function showSide(v: SideView) { sideView.set(v); setPref('side.view', v); setLayout(isFull(v) ? { focus: false } : { rail: true, focus: false }) }

// The pages that are sections open there (one route per page). Any other page is a tab, so the tab area comes back
// when a whole-page section is on show.
export const PAGE_SECTION: Partial<Record<ToolTab, SideView>> = { running: 'running', scheduled: 'scheduled', deploys: 'deploy', status: 'usage', watchers: 'watchers' }
sectionRoute.go = (page) => {
  const v = PAGE_SECTION[page]
  if (v) showSide(v)
  else if (isFull(sideView.get())) showSide('threads')
  return !!v
}

// the rail's own destinations; every other section is under More, in these groups
const MAIN: SideView[] = ['threads', 'scheduled', 'files', 'todo', 'notes']
const MORE: { group: string; ids: SideView[] }[] = [
  { group: 'Code', ids: ['git', 'pull', 'scripts', 'dependabot'] },
  { group: 'Automation', ids: ['running', 'watchers', 'deploy', 'env'] },
  { group: 'Workspace', ids: ['usage', 'board'] },
  { group: 'Tools', ids: ['codex', 'quarry', 'allow', 'accounts'] },
]
const viewOf = (id: SideView) => VIEWS.find((x) => x.id === id)!

export function ActivityBar() {
  const quarry = useQuarry() // Quarry is listed only when it is installed and usable
  const { layout } = useAppearance()
  const view = useStore(sideView, (v) => v)
  const waiting = useStore(liveStore, (l) => l.waiting.length)
  const working = useStore(liveStore, (l) => l.working.length)
  const allow = useAllow()
  const [more, setMore] = useState<Anchor | null>(null)
  const open = layout.rail && !layout.focus
  const on = (v: SideView) => view === v && (open || isFull(v))
  // a whole-page section is simply shown; a side bar section hides its side bar when its button is clicked again
  const pick = (v: SideView) => (!isFull(v) && open && v === view ? setLayout({ rail: false }) : showSide(v))
  // what a destination says beside it: threads waiting for you, threads working, an address that is not allowed yet
  const mark = (v: SideView) => (v === 'threads' && waiting > 0 ? String(waiting) : v === 'running' && working > 0 ? String(working) : v === 'allow' && allow?.changed ? '!' : '')
  const groups = MORE.map((g) => ({ ...g, ids: g.ids.filter((id) => id !== 'quarry' || quarry?.available) }))
  const inMore = groups.some((g) => g.ids.includes(view))
  // the menu opens beside the rail, level with its button
  const openMore = (el: HTMLElement) => { const r = el.getBoundingClientRect(); const x = layout.railRight ? r.left - 4 : r.right + 4; setMore({ left: x, right: x, top: r.bottom, bottom: r.top - 2 }) }
  return (
    <nav className="abar" aria-label="Sections" data-testid="activity-bar">
      {MAIN.map(viewOf).map((v) => (
        <button key={v.id} className={`abar-item${on(v.id) ? ' on' : ''}`} onClick={() => pick(v.id)} title={v.label} aria-pressed={on(v.id)} data-testid={`abar-${v.id}`}>
          {v.brand ? <BrandIcon name={v.brand} size={20} /> : <i className={`codicon codicon-${v.icon}`} aria-hidden />}
          <span className="abar-label">{v.label}</span>
          {mark(v.id) && <span className="abar-mark">{mark(v.id)}</span>}
        </button>
      ))}
      {/* its own mousedown is kept from the open menu's click-outside, so a second click closes the menu and does not reopen it */}
      <button className={`abar-item${inMore || more ? ' on' : ''}`} onMouseDown={(e) => { if (more) e.stopPropagation() }} onClick={(e) => (more ? setMore(null) : openMore(e.currentTarget))}
        title={inMore ? `More: ${labelOf(view)}` : 'More: every other section'} aria-haspopup="menu" aria-expanded={!!more} data-testid="abar-more">
        <i className="codicon codicon-ellipsis" aria-hidden />
        <span className="abar-label">More</span>
        {mark('allow') && <span className="abar-mark">{mark('allow')}</span>}
      </button>
      {more && <MoreMenu anchor={more} groups={groups} align={layout.railRight ? 'right' : 'left'} view={view} mark={mark} onPick={showSide} onClose={() => setMore(null)} />}
      <div className="abar-gap" />
      <LimitGauges onOpen={() => showSide('usage')} />
      <button className={`abar-item${layout.drawer ? ' on' : ''}`} onClick={() => toggleTerminal()} title="Terminal (Ctrl+`)" aria-pressed={layout.drawer} data-testid="abar-terminal"><i className="codicon codicon-terminal" aria-hidden /><span className="abar-label">Terminal</span></button>
      <button className="abar-item" onClick={() => openPage('settings')} title="Settings (Ctrl+,)" data-testid="abar-settings"><i className="codicon codicon-settings-gear" aria-hidden /><span className="abar-label">Settings</span></button>
    </nav>
  )
}

// More: every section that has no place of its own on the rail. A menu: the first row takes the focus, the arrows move,
// Escape (or Tab, or a click outside) closes it, and the focus goes back to the More button.
function MoreMenu({ anchor, groups, align, view, mark, onPick, onClose }: {
  anchor: Anchor; groups: { group: string; ids: SideView[] }[]; align: 'left' | 'right'; view: SideView; mark: (v: SideView) => string; onPick: (v: SideView) => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const keys = useMenuKeys(ref)
  // the popover is hidden until it has been placed, and a hidden row cannot take the focus: focus once it is drawn
  useEffect(() => { const t = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('.pop-row.on') ?? ref.current?.querySelector<HTMLElement>('.pop-row'))?.focus()); return () => cancelAnimationFrame(t) }, [])
  return (
    <Popover anchor={anchor} onClose={onClose} width={208} align={align} testid="abar-more-menu">
      <div className="poplist" role="menu" aria-label="More sections" ref={ref} onKeyDown={(e) => { if (e.key === 'Tab') onClose(); else keys(e) }}>
        {groups.map((g) => (
          <Fragment key={g.group}>
            <div className="pop-group">{g.group}</div>
            {g.ids.map(viewOf).map((v) => (
              <button key={v.id} className={v.id === view ? 'pop-row on' : 'pop-row'} role="menuitem" onClick={() => { onClose(); onPick(v.id) }} data-testid={`abar-${v.id}`}>
                {v.brand ? <BrandIcon name={v.brand} size={14} /> : <i className={`codicon codicon-${v.icon}`} aria-hidden />}
                <span className="pop-label">{v.label}</span>
                {mark(v.id) && <span className="abar-mark in-menu">{mark(v.id)}</span>}
              </button>
            ))}
          </Fragment>
        ))}
      </div>
    </Popover>
  )
}

// ---------- side bar sections: Files, Threads, Git ----------
const MIN_W = 220, MAX_W = 760, DEFAULT_W = 300

export function SideBar({ currentPage }: { currentPage: ToolTab | null }) {
  const section = useStore(sideView, (v) => v)
  const [width, setWidth] = useState(() => Math.max(MIN_W, Math.min(MAX_W, getPref<number>('side.width', DEFAULT_W))))
  const drag = useRef<{ x: number; w: number } | null>(null)
  useEffect(() => {
    const move = (e: MouseEvent) => { if (drag.current) setWidth(Math.max(MIN_W, Math.min(MAX_W, drag.current.w + e.clientX - drag.current.x))) }
    const up = () => { if (!drag.current) return; drag.current = null; document.body.classList.remove('side-drag'); setWidth((w) => { setPref('side.width', w); return w }) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])
  // beside a whole-page section the side bar shows Threads, so the threads stay in view
  const full = isFull(section)
  const view = full ? 'threads' : section
  const title = labelOf(view)
  return (
    <aside className="side" style={{ width }} data-testid="side-bar" data-view={view} aria-label={title}>
      <div className="side-head"><span>{title}</span><button className="side-hide" onClick={() => setLayout({ rail: false })} title="Hide the side bar (Ctrl+[). Its button on the rail brings it back" aria-label="Hide the side bar" data-testid="side-hide"><i className="codicon codicon-chevron-left" aria-hidden /></button></div>
      {/* a thread picked beside a whole page brings the tab area back, also the one that already had the focus */}
      <div className={`side-body side-${view}`} onClick={full ? (e) => { const t = e.target as HTMLElement; if (t.closest('.rail-row') && !t.closest('button')) showSide('threads') } : undefined}>
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
          <button className="full-back" onClick={() => showSide('threads')} data-testid="section-back"><i className="codicon codicon-arrow-left" aria-hidden />Back to threads<Keys k="Esc" /></button>
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
    case 'running': return <RunningPage />
    case 'scheduled': return <ScheduledPage />
    case 'usage': return <StatusPage />
    case 'board': return <BoardPage />
    case 'pull': return <Page title="Pull"><PullTab /></Page>
    case 'scripts': return <Page title="Scripts"><ScriptsTab /></Page>
    case 'dependabot': return <Page title="Dependabot"><DependabotTab /></Page>
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
