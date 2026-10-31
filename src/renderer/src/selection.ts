// Bulk selection for the sessions sidebar: pure logic over ordered id lists. No React, no storage.
import type { Section, ThreadMap, ThreadState } from './threads'

// ids in on-screen order: every section top to bottom, skipping folded ones
export function visibleOrder<T extends { id: string }>(sections: Section<T>[], open: Set<string>, searching: boolean): string[] {
  return sections.flatMap((sec) => (sec.fold && !searching && !open.has(sec.key) ? [] : sec.items.map((s) => s.id)))
}

// the ids from `from` to `to` inclusive, in either direction; just `to` if `from` isn't on screen
export function rangeIds(order: string[], from: string | null, to: string): string[] {
  const a = from === null ? -1 : order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

export type Selection = { selected: Set<string>; anchor: string | null }

// Ctrl/Cmd toggles one row; Shift selects anchor..row (replacing, or added to the selection with Ctrl); the anchor moves on a
// Ctrl or plain click and stays put on a Shift click, so a range can be re-aimed
export function clickRow(order: string[], cur: Selection, id: string, mod: { ctrl: boolean; shift: boolean }): Selection {
  if (mod.shift) {
    const range = rangeIds(order, cur.anchor, id)
    return { selected: new Set(mod.ctrl ? [...cur.selected, ...range] : range), anchor: cur.anchor ?? id }
  }
  if (mod.ctrl) {
    const next = new Set(cur.selected)
    if (!next.delete(id)) next.add(id)
    return { selected: next, anchor: id }
  }
  return { selected: cur.selected, anchor: id }
}

export type FlagAction = { on: boolean; label: string }
type Flag = 'pinned' | 'closedAt' | 'archivedAt'
const WORDS: Record<Flag, [string, string]> = { pinned: ['Pin', 'Unpin'], closedAt: ['Close', 'Reopen'], archivedAt: ['Archive', 'Unarchive'] }

// which way a flag can go for these threads: set where none has it, clear where all do, both when mixed
export function flagActions(states: ThreadMap, ids: string[], flag: Flag): FlagAction[] {
  const has = ids.filter((id) => (states[id] as ThreadState | undefined)?.[flag])
  const [set, unset] = WORDS[flag]
  if (!ids.length) return []
  if (!has.length) return [{ on: true, label: set }]
  if (has.length === ids.length) return [{ on: false, label: unset }]
  return [{ on: true, label: set }, { on: false, label: unset }]
}

// which threads a row's menu acts on, like File Explorer: the whole selection when the row is in it, else just that row
export function menuTargets(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected : [id]
}
