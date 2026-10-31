// Chat panes: up to four, each with its own tabs and active tab. Pure logic; the app keeps one PaneState.
// Every visible (not backgrounded) session sits in exactly one pane; reconcile() keeps that true after sessions
// open, close or move to the background.
import { nextActive } from './tabs'

export type Pane = { id: string; tabs: string[]; active: string | null }
export type PaneState = { panes: Pane[]; focus: string }
export const MAX_PANES = 4

let n = 0
const newId = () => `p${Date.now().toString(36)}${n++}`
export const emptyPanes = (): PaneState => { const id = newId(); return { panes: [{ id, tabs: [], active: null }], focus: id } }

const focusedPane = (s: PaneState) => s.panes.find((p) => p.id === s.focus) ?? s.panes[0]

// drop tabs that are no longer visible (the pane's active moves to the nearest survivor), put new visible ones in the
// focused pane, and remove empty panes while more than one is left
export function reconcile(s: PaneState, visible: string[]): PaneState {
  const vis = new Set(visible)
  let changed = false
  let panes = s.panes.map((p) => {
    const tabs = p.tabs.filter((id) => vis.has(id))
    if (tabs.length === p.tabs.length && (p.active === null || tabs.includes(p.active)) && !(p.active === null && tabs.length)) return p
    changed = true
    const gone = p.tabs.filter((id) => !vis.has(id))
    let active = p.active && tabs.includes(p.active) ? p.active : nextActive(p.tabs, gone, p.active, p.active ?? '')
    if (!active && tabs.length) active = tabs[tabs.length - 1]
    return { ...p, tabs, active }
  })
  const placed = new Set(panes.flatMap((p) => p.tabs))
  const fresh = visible.filter((id) => !placed.has(id))
  let focus = s.focus
  if (!panes.some((p) => p.id === focus)) { focus = panes[0]?.id ?? focus; changed = true }
  if (fresh.length) {
    changed = true
    panes = panes.map((p) => (p.id === focus ? { ...p, tabs: [...p.tabs, ...fresh], active: fresh[fresh.length - 1] } : p))
  }
  if (panes.length > 1 && panes.some((p) => !p.tabs.length)) {
    changed = true
    const idx = panes.findIndex((p) => p.id === focus)
    panes = panes.filter((p) => p.tabs.length)
    if (!panes.length) panes = [s.panes[0]]
    if (!panes.some((p) => p.id === focus)) focus = panes[Math.max(0, Math.min(idx - 1, panes.length - 1))].id
  }
  return changed ? { panes, focus } : s
}

// show a tab: in the pane that holds it (and focus that pane), else add it to the focused pane
export function activate(s: PaneState, tab: string): PaneState {
  const holder = s.panes.find((p) => p.tabs.includes(tab))
  if (holder) {
    if (holder.active === tab && s.focus === holder.id) return s
    return { panes: s.panes.map((p) => (p.id === holder.id ? { ...p, active: tab } : p)), focus: holder.id }
  }
  const f = focusedPane(s)
  return { ...s, panes: s.panes.map((p) => (p.id === f.id ? { ...p, tabs: [...p.tabs, tab], active: tab } : p)) }
}

export const focusPane = (s: PaneState, id: string): PaneState => (s.focus === id || !s.panes.some((p) => p.id === id) ? s : { ...s, focus: id })

// move a tab into another pane (at index, else the end); the source pane picks its nearest tab
export function moveTab(s: PaneState, tab: string, to: string, index?: number): PaneState {
  const from = s.panes.find((p) => p.tabs.includes(tab))
  if (!from || !s.panes.some((p) => p.id === to)) return s
  let panes = s.panes.map((p) => {
    if (p.id === from.id && p.id === to) {
      const rest = p.tabs.filter((id) => id !== tab)
      const at = Math.max(0, Math.min(index ?? rest.length, rest.length))
      return { ...p, tabs: [...rest.slice(0, at), tab, ...rest.slice(at)], active: tab }
    }
    if (p.id === from.id) {
      const tabs = p.tabs.filter((id) => id !== tab)
      return { ...p, tabs, active: p.active === tab ? nextActive(p.tabs, [tab], p.active, tab) : p.active }
    }
    if (p.id === to) {
      const at = Math.max(0, Math.min(index ?? p.tabs.length, p.tabs.length))
      return { ...p, tabs: [...p.tabs.slice(0, at), tab, ...p.tabs.slice(at)], active: tab }
    }
    return p
  })
  panes = panes.filter((p) => p.tabs.length || p.id === to)
  return { panes, focus: to }
}

// split: a new pane right after `beside` holding `tab` (taken from wherever it is). Null when four panes are open
// or the tab is already alone in `beside`.
export function splitWith(s: PaneState, tab: string, beside: string): PaneState | null {
  if (s.panes.length >= MAX_PANES) return null
  const from = s.panes.find((p) => p.tabs.includes(tab))
  if (from && from.id === beside && from.tabs.length === 1) return null
  const pane: Pane = { id: newId(), tabs: [tab], active: tab }
  let panes = s.panes.map((p) => (p.tabs.includes(tab)
    ? { ...p, tabs: p.tabs.filter((id) => id !== tab), active: p.active === tab ? nextActive(p.tabs, [tab], p.active, tab) : p.active }
    : p))
  const i = panes.findIndex((p) => p.id === beside)
  panes = [...panes.slice(0, i + 1), pane, ...panes.slice(i + 1)].filter((p) => p.tabs.length)
  return { panes, focus: pane.id }
}

// add a new, empty-tabbed pane after `beside` that will receive the next opened tab (for "split" with nothing to move)
export function addPaneFor(s: PaneState, tab: string, beside: string): PaneState | null {
  if (s.panes.length >= MAX_PANES) return null
  const pane: Pane = { id: newId(), tabs: [tab], active: tab }
  const i = s.panes.findIndex((p) => p.id === beside)
  return { panes: [...s.panes.slice(0, i + 1), pane, ...s.panes.slice(i + 1)], focus: pane.id }
}

// the tab shown in the focused pane
export const focusedTab = (s: PaneState): string | null => focusedPane(s)?.active ?? null
