// The regions a UI arranges: a tabbed side view, the bottom panel, the activity bar (Workbench), the tool dock and
// the thread strip (Thread strip & dock), and the tools list under the threads (Default).
import { useState, type DragEvent, type ReactNode } from 'react'
import { getPref, setPref } from './prefs'
import type { Session } from './chat'
import { TAB_MIME } from './ChatArea'
import { VIEW, type ViewId } from './views'
import { Icon } from './ui'

export type Badge = { n?: number | string; cls?: string; title?: string }
export type Badges = Partial<Record<ViewId, Badge>>

const BadgeMark = ({ b }: { b?: Badge }) => (b && b.n !== undefined && b.n !== 0 && b.n !== '' ? <span className={`badge ${b.cls ?? ''}`} title={b.title}>{b.n}</span> : null)

export function SideTabs({ views, current, onPick, onClose, render, badges, testid, extra }: {
  views: ViewId[]; current: ViewId; onPick: (v: ViewId) => void; onClose?: () => void; render: (v: ViewId) => ReactNode; badges: Badges; testid: string; extra?: ReactNode
}) {
  const v = views.includes(current) ? current : views[0]
  return (
    <div className="sidehost" data-testid={testid}>
      <div className="tabs rtabs">
        {views.map((id) => (
          <button key={id} className={id === v ? 'tab rtab on' : 'tab rtab'} onClick={() => onPick(id)} data-testid={`${testid}-tab-${id}`}>
            <Icon name={VIEW[id].icon} className={VIEW[id].mk} />{VIEW[id].label}<BadgeMark b={badges[id]} />
          </button>
        ))}
        <span className="tr">
          {extra}
          {onClose && <button className="ibtn" title="Close" onClick={onClose} data-testid={`${testid}-close`}><Icon name="close" /></button>}
        </span>
      </div>
      <div className="sidebody">{render(v)}</div>
    </div>
  )
}

export function BottomPanel({ views, current, onPick, onClose, onMax, max, render, badges }: {
  views: ViewId[]; current: ViewId; onPick: (v: ViewId) => void; onClose: () => void; onMax: () => void; max: boolean; render: (v: ViewId) => ReactNode; badges: Badges
}) {
  const v = views.includes(current) ? current : views[0]
  return (
    <div className="bottom" data-testid="bottom-panel">
      <div className="btabs">
        {views.map((id) => (
          <button key={id} className={id === v ? 'btab on' : 'btab'} onClick={() => onPick(id)} data-testid={`bottom-tab-${id}`}>
            <Icon name={VIEW[id].icon} className={VIEW[id].mk} />{VIEW[id].label}<BadgeMark b={badges[id]} />
          </button>
        ))}
        <span className="tr">
          <button className="ibtn" title={max ? 'Restore panel size' : 'Maximize panel'} onClick={onMax} data-testid="bottom-max"><Icon name={max ? 'screen-normal' : 'screen-full'} /></button>
          <button className="ibtn" title="Hide panel (Ctrl+J)" onClick={onClose} data-testid="bottom-close"><Icon name="close" /></button>
        </span>
      </div>
      <div className="bbody">{render(v)}</div>
    </div>
  )
}

export function ActivityBar({ items, current, open, onPick, badges, bottom }: {
  items: ViewId[]; current: ViewId; open: boolean; onPick: (v: ViewId) => void; badges: Badges; bottom: ReactNode
}) {
  return (
    <nav className="activity" data-testid="activity-bar">
      {items.map((id) => (
        <button key={id} className={open && id === current ? 'act on' : 'act'} title={VIEW[id].label} onClick={() => onPick(id)} data-testid={`activity-${id}`}>
          <Icon name={VIEW[id].icon} />
          <BadgeMark b={badges[id]} />
        </button>
      ))}
      <span className="sp" />
      {bottom}
    </nav>
  )
}

export function Dock({ items, current, onPick, badges, extra }: { items: ViewId[]; current: ViewId | null; onPick: (v: ViewId) => void; badges: Badges; extra?: ReactNode }) {
  return (
    <nav className="dock" data-testid="tool-dock">
      {items.map((id) => (
        <button key={id} className={id === current ? 'dk on' : 'dk'} title={VIEW[id].label} onClick={() => onPick(id)} data-testid={`dock-${id}`}>
          <span className="dk-i"><Icon name={VIEW[id].icon} className={VIEW[id].mk} /><BadgeMark b={badges[id]} /></span>
          <span className="dk-l">{VIEW[id].label}</span>
        </button>
      ))}
      {extra}
    </nav>
  )
}

// thread tabs grouped by state: waiting, working, failed, done, then the rest
type StripGroup = { key: string; label: string; cls: string; items: Session[] }
export function stripGroups(sessions: Session[]): StripGroup[] {
  const g: StripGroup[] = [
    { key: 'waiting', label: 'WAITING', cls: 's-wait', items: [] },
    { key: 'working', label: 'WORKING', cls: 's-work', items: [] },
    { key: 'failed', label: 'FAILED', cls: 's-fail', items: [] },
    { key: 'done', label: 'DONE', cls: 's-done', items: [] },
    { key: 'open', label: 'OPEN', cls: 's-idle', items: [] },
  ]
  for (const s of sessions) {
    const failed = s.items.at(-1)?.kind === 'error' || s.waitingReason?.startsWith('Failed')
    const k = s.busy ? 'working' : failed ? 'failed' : s.waitingSince && !s.waitingReason?.startsWith('Finished') ? 'waiting'
      : s.waitingReason?.startsWith('Finished') || (!s.busy && s.items.some((i) => i.kind === 'assistant') && s.background) ? 'done' : 'open'
    g.find((x) => x.key === k)!.items.push(s)
  }
  return g.filter((x) => x.items.length)
}

export function ThreadStrip({ sessions, shown, focused, onActivate, onAll, onNew, total }: {
  sessions: Session[]; shown: Set<string>; focused: string | null; onActivate: (id: string) => void; onAll: (el: HTMLElement) => void; onNew: () => void; total: number
}) {
  const icon = (s: Session): [string, string] => (s.busy ? ['loading', 'spin s-work'] : s.items.at(-1)?.kind === 'error' ? ['error', 's-fail']
    : s.waitingSince && !s.waitingReason?.startsWith('Finished') ? ['bell-dot', 's-wait blink'] : s.waitingReason?.startsWith('Finished') ? ['pass-filled', 's-done'] : ['comment-discussion', 's-idle'])
  return (
    <div className="strip" data-testid="thread-strip">
      <button className="strip-all" onClick={(e) => onAll(e.currentTarget)} data-testid="strip-all-threads"><Icon name="list-unordered" />All threads <b>{total}</b><Icon name="chevron-down" /></button>
      <div className="strip-tabs">
        {stripGroups(sessions).map((g) => (
          <div key={g.key} className="stgroup">
            <span className={`sglabel st ${g.cls}`}>{g.label}</span>
            {g.items.map((s) => {
              const [i, c] = icon(s)
              return (
                <button key={s.id} className={`stab${s.id === focused ? ' on' : ''}${shown.has(s.id) ? ' shown' : ''}${s.background ? ' bg' : ''}`} onClick={() => onActivate(s.id)} title={`${s.title}${s.waitingReason ? `: ${s.waitingReason}` : ''} (drag onto a column)`}
                  draggable={!s.background} onDragStart={(e: DragEvent) => { e.dataTransfer.setData(TAB_MIME, s.id); e.dataTransfer.effectAllowed = 'move' }} data-testid={`strip-tab-${s.id}`}>
                  <Icon name={i} className={c} /><span className="tt">{s.title}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <button className="ibtn" title="New thread" onClick={onNew} data-testid="strip-new"><Icon name="add" /></button>
    </div>
  )
}

export type ToolRow = { id: string; label: string; icon: string; mk: string; status?: string; cls?: string }
// a section under the threads whose header folds it; the fold is remembered
export function Fold({ id, title, icon, count, children, testid }: { id: string; title: string; icon?: ReactNode; count?: ReactNode; children: ReactNode; testid: string }) {
  const [open, setOpen] = useState(() => getPref<boolean>(`fold.${id}`, true))
  const flip = () => { setOpen(!open); setPref(`fold.${id}`, !open) }
  return (
    <div className={open ? 'fold-sec open' : 'fold-sec'} data-testid={testid}>
      <button className="cap fold-h" onClick={flip} data-testid={`${testid}-fold`}><Icon name={open ? 'chevron-down' : 'chevron-right'} />{icon}{title}{count !== undefined && <span className="n">{count}</span>}</button>
      {open && children}
    </div>
  )
}

export function ToolList({ rows, onOpen }: { rows: ToolRow[]; onOpen: (id: string, el: HTMLElement) => void }) {
  return (
    <Fold id="tools" title="Tools" testid="tools-list">
      {rows.map((r) => (
        <button key={r.id} className="trow" onClick={(e) => onOpen(r.id, e.currentTarget)} data-testid={`tool-${r.id}`}>
          <Icon name={r.icon} className={r.mk} />
          <span className="tl-l">{r.label}</span>
          <span className={`tl-s ${r.cls ?? ''}`}>{r.status}</span>
        </button>
      ))}
    </Fold>
  )
}
