// The chat area: up to four panes, each with its own tabs. Drag a tab onto another pane to move it there, or onto a
// pane's right or bottom edge to split (up to four). Layout 'grid' places 2 side by side, 3 as one left plus two
// stacked, 4 as 2x2; 'columns' puts every pane in a column; 'single' shows only the focused pane.
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Session } from './chat'
import { MAX_PANES, type Pane, type PaneState } from './panes'
import { FracDivider, Icon, useFraction } from './ui'

export const TAB_MIME = 'application/x-hive-tab'

type Zone = 'center' | 'right' | 'bottom'
type Props = {
  state: PaneState
  sessions: Session[]
  layout: 'grid' | 'columns' | 'single'
  tabs: 'full' | 'title' | 'none'
  render: (s: Session, pane: Pane, focused: boolean) => ReactNode
  onActivate: (tab: string) => void
  onFocusPane: (pane: string) => void
  onClose: (tab: string) => void
  onTabMenu: (tab: string, x: number, y: number) => void
  onMove: (tab: string, pane: string, index?: number) => void
  onSplit: (tab: string, beside: string) => void
  onNew: () => void
  empty: ReactNode
}

const stateIcon = (s: Session): [string, string] => (s.busy ? ['loading', 'spin s-work'] : s.waitingSince ? ['bell-dot', 's-wait blink']
  : s.items.at(-1)?.kind === 'error' ? ['error', 's-fail'] : ['comment-discussion', 's-idle'])

function PaneView({ pane, sessions, focused, tabs, canSplit, render, onActivate, onFocusPane, onClose, onTabMenu, onMove, onSplit, onNew, solo }: {
  pane: Pane; sessions: Session[]; focused: boolean; tabs: Props['tabs']; canSplit: boolean; solo: boolean
} & Pick<Props, 'render' | 'onActivate' | 'onFocusPane' | 'onClose' | 'onTabMenu' | 'onMove' | 'onSplit' | 'onNew'>) {
  const [zone, setZone] = useState<Zone | null>(null)
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const active = pane.active ? byId.get(pane.active) : undefined
  const zoneAt = (e: DragEvent<HTMLDivElement>): Zone => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    if (canSplit && x > 0.72) return 'right'
    if (canSplit && y > 0.72) return 'bottom'
    return 'center'
  }
  const over = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setZone(zoneAt(e))
  }
  const drop = (e: DragEvent<HTMLDivElement>) => {
    const tab = e.dataTransfer.getData(TAB_MIME)
    setZone(null)
    if (!tab) return
    e.preventDefault()
    e.stopPropagation()
    const z = zoneAt(e)
    if (z === 'center') onMove(tab, pane.id)
    else onSplit(tab, pane.id)
  }
  const dropOnTab = (e: DragEvent<HTMLElement>, index: number) => {
    const tab = e.dataTransfer.getData(TAB_MIME)
    if (!tab) return
    e.preventDefault(); e.stopPropagation(); setZone(null)
    onMove(tab, pane.id, index)
  }
  return (
    <div className={`pane${focused ? ' focused' : ''}${solo ? ' solo' : ''}`} onMouseDown={() => onFocusPane(pane.id)} data-testid="chat-pane">
      {tabs !== 'none' && (
        <div className="tabs ptabs" onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault() }} onDrop={(e) => dropOnTab(e, pane.tabs.length)}>
          {(tabs === 'full' ? pane.tabs : pane.active ? [pane.active] : []).map((id, i) => {
            const s = byId.get(id)
            if (!s) return null
            const [icon, cls] = stateIcon(s)
            return (
              <div key={id} className={`tab ptab${id === pane.active ? ' on' : ''}${id === pane.active && !focused ? ' blur' : ''}`} draggable
                onDragStart={(e) => { e.dataTransfer.setData(TAB_MIME, id); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault() }}
                onDrop={(e) => dropOnTab(e, i)}
                onClick={() => onActivate(id)} onAuxClick={(e) => { if (e.button === 1) onClose(id) }}
                onContextMenu={(e) => { e.preventDefault(); onTabMenu(id, e.clientX, e.clientY) }} title={`${s.title} (drag to move or split)`}
                data-testid="tab" data-id={id}>
                <Icon name={icon} className={cls} />
                <span className="tt">{s.title}</span>
                <button className="x" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(id) }} data-testid={`tab-close-${id}`}><Icon name="close" /></button>
              </div>
            )
          })}
          <span className="tr">
            <button className="ibtn" title="New thread" onClick={(e) => { e.stopPropagation(); onFocusPane(pane.id); onNew() }} data-testid="pane-new"><Icon name="add" /></button>
            {canSplit && active && <button className="ibtn" title="Split: open a new thread beside this one" onClick={(e) => { e.stopPropagation(); onSplit('', pane.id) }} data-testid="pane-split"><Icon name="split-horizontal" /></button>}
          </span>
        </div>
      )}
      <div className="pane-body" onDragOver={over} onDragLeave={() => setZone(null)} onDrop={drop}>
        {active ? render(active, pane, focused) : <div className="pane-empty">Drop a tab here or open a thread.</div>}
        {zone && <div className={`dropzone ${zone}`}><span>{zone === 'center' ? 'Move here' : zone === 'right' ? 'Split right' : 'Split down'}</span></div>}
      </div>
    </div>
  )
}

export function ChatArea(p: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [col, setCol, saveCol] = useFraction(`chat.col.${p.layout}`, 0.5)
  const [row, setRow, saveRow] = useFraction('chat.row', 0.5)
  const visible = p.state.panes.filter((x) => x.tabs.length || p.state.panes.length === 1)
  if (!p.sessions.some((s) => !s.background)) return <div className="chatarea">{p.empty}</div>
  const panes = p.layout === 'single' ? visible.filter((x) => x.id === p.state.focus).slice(0, 1).concat(visible.length && !visible.some((x) => x.id === p.state.focus) ? [visible[0]] : []) : visible
  const n = panes.length
  const canSplit = p.layout !== 'single' && p.state.panes.length < MAX_PANES
  const one = (pane: Pane, style?: React.CSSProperties) => (
    <div key={pane.id} className="cell" style={style}>
      <PaneView pane={pane} sessions={p.sessions} focused={pane.id === p.state.focus || n === 1} tabs={p.tabs} canSplit={canSplit} solo={n === 1}
        render={p.render} onActivate={p.onActivate} onFocusPane={p.onFocusPane} onClose={p.onClose} onTabMenu={p.onTabMenu} onMove={p.onMove} onSplit={p.onSplit} onNew={p.onNew} />
    </div>
  )
  const c = `${(col * 100).toFixed(2)}%`
  const r = `${(row * 100).toFixed(2)}%`
  let grid: React.CSSProperties
  let cells: ReactNode[]
  let dividers: ReactNode = null
  if (n === 1) { grid = { gridTemplate: '1fr / 1fr' }; cells = [one(panes[0])] }
  else if (p.layout === 'columns') {
    grid = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gridTemplateRows: '1fr' }
    cells = panes.map((x) => one(x))
  } else if (n === 2) {
    grid = { gridTemplateColumns: `${c} minmax(0, 1fr)`, gridTemplateRows: '1fr' }
    cells = panes.map((x) => one(x))
    dividers = <FracDivider dir="v" container={box} setFrac={setCol} save={saveCol} style={{ left: c }} testid="chat-divider-col" />
  } else if (n === 3) {
    grid = { gridTemplateColumns: `${c} minmax(0, 1fr)`, gridTemplateRows: `${r} minmax(0, 1fr)` }
    cells = [one(panes[0], { gridRow: '1 / 3' }), one(panes[1]), one(panes[2])]
    dividers = <><FracDivider dir="v" container={box} setFrac={setCol} save={saveCol} style={{ left: c }} testid="chat-divider-col" />
      <FracDivider dir="h" container={box} setFrac={setRow} save={saveRow} style={{ top: r, left: c }} testid="chat-divider-row" /></>
  } else {
    grid = { gridTemplateColumns: `${c} minmax(0, 1fr)`, gridTemplateRows: `${r} minmax(0, 1fr)` }
    cells = panes.map((x) => one(x))
    dividers = <><FracDivider dir="v" container={box} setFrac={setCol} save={saveCol} style={{ left: c }} testid="chat-divider-col" />
      <FracDivider dir="h" container={box} setFrac={setRow} save={saveRow} style={{ top: r }} testid="chat-divider-row" /></>
  }
  return (
    <div className={`chatarea n${n}`} ref={box} style={grid} data-testid="chat-area">
      {cells}
      {dividers}
    </div>
  )
}
