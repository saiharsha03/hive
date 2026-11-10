// The tab row and the panes. One row lists every open tab, pane by pane, each starting with its state word; the
// focused one carries the accent rule. One to four panes: two side by side, three as columns, four as 2 by 2. Drag
// a tab onto a pane to move it there, onto a pane's right or bottom edge to split. Each pane draws only its own
// active tab, so a reply streaming in one pane does not re-render the others.
import { memo, useCallback, useState, type DragEvent, type ReactNode } from 'react'
import { activate, closeSession, moveToBackground, newSession, visibleNow, setPanes } from './actions'
import { activate as activateIn, focusPane, moveTab, reconcile, splitWith, MAX_PANES } from './panes'
import { panes as panesStore, useSessionMetas, useStore, shallowEq, setSessions, getSessions, type SessionMeta } from './store'
import { activateSession } from './background'
import { isDirty, useDirtyVersion } from './EditorView'
import { TabMenu } from './TabMenu'
import { tabsToClose, type TabCloseAction } from './tabs'
import { State, type Tone } from './kit'
import { live as liveStore } from './actions'
import { liveLook } from './Rail'
import type { LiveRow } from './background'

export const TAB_MIME = 'application/x-hive-tab'

// a tab's state word: threads only (files and pages have none)
export function tabWord(s: SessionMeta, live?: LiveRow): [string, Tone] | null {
  if (s.tool || s.file) return null
  if (s.compacting) return ['COMPACTING', 'work']
  if (live) { const l = liveLook(live); return [l.word, l.tone] }
  if (s.busy) return ['WORKING', 'work']
  if (s.waitingSince) return /^failed/i.test(s.waitingReason ?? '') ? ['FAILED', 'fail'] : /^finished/i.test(s.waitingReason ?? '') ? ['DONE', 'done'] : ['WAITING', 'wait']
  if (s.endedRun) return ['ENDED', 'idle']
  return ['IDLE', 'idle']
}

const bringBack = (tab: string) => { if (getSessions().find((s) => s.id === tab)?.background) setSessions((all) => activateSession(all, tab)) }
export function moveTabTo(tab: string, pane: string, index?: number) {
  bringBack(tab)
  setPanes((p) => moveTab(activateIn(reconcile(p, visibleNow().concat(tab)), tab), tab, pane, index))
}
export function splitTabBeside(tab: string, beside: string) {
  bringBack(tab)
  setPanes((p) => { const base = activateIn(reconcile(p, visibleNow().concat(tab)), tab); return splitWith(base, tab, beside) ?? moveTab(base, tab, beside) })
}

export function TabRow() {
  const metas = useSessionMetas()
  const live = useStore(liveStore, (l) => l)
  const liveOf = new Map([...live.waiting, ...live.working].map((r) => [r.id, r]))
  const p = useStore(panesStore, (x) => x)
  useDirtyVersion() // a file tab's unsaved mark
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const byId = new Map(metas.map((s) => [s.id, s]))
  const focused = p.panes.find((x) => x.id === p.focus)?.active ?? null
  const shown = new Set(p.panes.map((x) => x.active))
  const tabs = p.panes.flatMap((pane) => pane.tabs.map((id) => ({ id, pane: pane.id })))
  const paneTabsOf = (id: string) => p.panes.find((x) => x.tabs.includes(id))?.tabs ?? [id]
  const onClose = (id: string) => closeSession(id)
  return (
    <div className="tabrow" role="tablist" aria-label="Open tabs" data-testid="tabrow"
      onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault() }}
      onDrop={(e) => { const tab = e.dataTransfer.getData(TAB_MIME); if (tab) { e.preventDefault(); moveTabTo(tab, p.focus) } }}>
      {tabs.map(({ id, pane }, i) => {
        const s = byId.get(id)
        if (!s) return null
        const w = tabWord(s, liveOf.get(id))
        const dirty = !!s.file && isDirty(s.file)
        return (
          <div key={id} className={`tab${id === focused ? ' on' : ''}${shown.has(id) && id !== focused ? ' shown' : ''}`} draggable role="tab" tabIndex={0} aria-selected={id === focused}
            onDragStart={(e) => { e.dataTransfer.setData(TAB_MIME, id); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault() }}
            onDrop={(e) => { const tab = e.dataTransfer.getData(TAB_MIME); if (!tab) return; e.preventDefault(); e.stopPropagation(); moveTabTo(tab, pane, p.panes.find((x) => x.id === pane)!.tabs.indexOf(id)) }}
            onClick={() => activate(id)} onAuxClick={(e) => { if (e.button === 1) onClose(id) }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(id) }
              else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ id, x: r.left, y: r.bottom }) }
              else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const sib = e.key === 'ArrowRight' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling; (sib as HTMLElement | null)?.focus() }
            }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ id, x: e.clientX, y: e.clientY }) }}
            title={`${s.title}${tabs.length > 1 ? ' (drag onto a pane to move it, onto its edge to split)' : ''}`}
            data-testid="tab" data-id={id} data-index={i}>
            {w && <State word={w[0]} tone={w[1]} />}
            <span className="tab-t">{s.title}</span>
            {dirty && <span className="tab-dirty" data-testid="tab-dirty">M</span>}
            <button className="tab-x" aria-label={`Close ${s.title}`} onClick={(e) => { e.stopPropagation(); onClose(id) }} data-testid={`tab-close-${id}`}>×</button>
          </div>
        )
      })}
      <span className="tabrow-sp" />
      {menu && byId.has(menu.id) && (
        <TabMenu ids={paneTabsOf(menu.id)} target={menu.id} x={menu.x} y={menu.y}
          onPick={(a: TabCloseAction) => tabsToClose(paneTabsOf(menu.id), menu.id, a).forEach((id) => closeSession(id))}
          onBackground={() => moveToBackground(menu.id)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

type Zone = 'center' | 'right' | 'bottom'
const PaneView = memo(function PaneView({ id, n, render }: { id: string; n: number; render: (tab: string, focused: boolean) => ReactNode }) {
  const pane = useStore(panesStore, useCallback((p: ReturnType<typeof panesStore.get>) => {
    const x = p.panes.find((q) => q.id === id)
    return { active: x?.active ?? null, focused: p.focus === id, count: p.panes.length }
  }, [id]), shallowEq)
  const [zone, setZone] = useState<Zone | null>(null)
  const canSplit = pane.count < MAX_PANES
  const zoneAt = (e: DragEvent<HTMLDivElement>): Zone => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    if (canSplit && x > 0.72) return 'right'
    if (canSplit && y > 0.72) return 'bottom'
    return 'center'
  }
  return (
    <div className={`pane${pane.focused && n > 1 ? ' focused' : ''}`} onMouseDownCapture={() => setPanes((p) => focusPane(p, id))} data-testid="chat-pane"
      onDragOver={(e) => { if (!e.dataTransfer.types.includes(TAB_MIME)) return; e.preventDefault(); setZone(zoneAt(e)) }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        const tab = e.dataTransfer.getData(TAB_MIME)
        setZone(null)
        if (!tab) return
        e.preventDefault()
        if (zoneAt(e) === 'center') moveTabTo(tab, id); else splitTabBeside(tab, id)
      }}>
      <div className="pane-body">{pane.active ? render(pane.active, pane.focused) : <div className="pane-empty">Drop a tab here, or open a thread from the rail.</div>}</div>
      {zone && <div className="pane-drop" style={zone === 'center' ? { inset: 0 } : zone === 'right' ? { top: 0, bottom: 0, right: 0, width: '30%' } : { left: 0, right: 0, bottom: 0, height: '30%' }} />}
    </div>
  )
})

export function Panes({ render, empty }: { render: (tab: string, focused: boolean) => ReactNode; empty: ReactNode }) {
  const ids = useStore(panesStore, (p) => p.panes.filter((x) => x.tabs.length || p.panes.length === 1).map((x) => x.id).join(' '))
  const any = useStore(panesStore, (p) => p.panes.some((x) => x.tabs.length))
  const list = ids.split(' ').filter(Boolean)
  if (!any) return <div className="panes n1">{empty}</div>
  return (
    <div className={`panes n${list.length}`} data-testid="chat-area">
      {list.map((id) => <PaneView key={id} id={id} n={list.length} render={render} />)}
    </div>
  )
}

export const newThreadInPane = (pane: string) => { setPanes((p) => focusPane(p, pane)); newSession() }
export const closeTabsBy = (ids: string[], target: string, a: TabCloseAction) => tabsToClose(ids, target, a).forEach((id) => closeSession(id))
