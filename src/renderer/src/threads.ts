// Thread organisation for the sessions sidebar: pin, snooze, close, archive. Pure logic first, storage and the hook below.
import { useSyncExternalStore } from 'react'

export type ThreadState = { pinned?: number; snoozedUntil?: number; snoozedAt?: number; closedAt?: number; archivedAt?: number }
export type ThreadMap = Record<string, ThreadState>
export type Place = 'pinned' | 'returned' | 'active' | 'snoozed' | 'closed' | 'archived'

const HOUR = 3_600_000
const DAY = 86_400_000

export function bucket(t: number, now = Date.now()): string {
  const today = new Date(now).setHours(0, 0, 0, 0)
  if (t >= today) return 'Today'
  if (t >= today - DAY) return 'Yesterday'
  if (t >= today - 7 * DAY) return 'This week'
  if (t >= today - 30 * DAY) return 'This month'
  return 'Older'
}

export type Preset = '1h' | '3h' | 'tomorrow' | 'monday'
export const PRESETS: { id: Preset; label: string }[] = [
  { id: '1h', label: 'In 1 hour' },
  { id: '3h', label: 'In 3 hours' },
  { id: 'tomorrow', label: 'Tomorrow 9 AM' },
  { id: 'monday', label: 'Next Monday 9 AM' },
]

export function presetTime(p: Preset, now: number): number {
  if (p === '1h') return now + HOUR
  if (p === '3h') return now + 3 * HOUR
  const d = new Date(now)
  d.setHours(9, 0, 0, 0)
  // always a later Monday, so on a Monday it means next week's
  d.setDate(d.getDate() + (p === 'tomorrow' ? 1 : ((8 - d.getDay()) % 7 || 7)))
  return d.getTime()
}

// where a thread sits; pinned wins unless archived, and a snooze only hides a thread until it comes due
export function place(s: ThreadState | undefined, now: number): Place {
  if (!s) return 'active'
  if (s.archivedAt) return 'archived'
  if (s.pinned) return 'pinned'
  if (s.closedAt) return 'closed'
  if (s.snoozedUntil) return s.snoozedUntil > now ? 'snoozed' : 'returned'
  return 'active'
}

// "Tue 9 AM", with the date when it is more than a week out; ":30" only when needed
export function untilLabel(t: number, now: number): string {
  const d = new Date(t)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined })
  if (d.toDateString() === new Date(now).toDateString()) return time
  if (t - now > 6 * DAY) return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}

// the dim word shown beside a thread when it is listed outside its own section (search, archive view)
export function stateLabel(s: ThreadState | undefined, now: number): string {
  switch (place(s, now)) {
    case 'archived': return 'archived'
    case 'pinned': return 'pinned'
    case 'closed': return 'closed'
    case 'snoozed': return `until ${untilLabel(s!.snoozedUntil!, now)}`
    case 'returned': return 'back from snooze'
    default: return ''
  }
}

export type Section<T> = { key: string; label: string; items: T[]; fold?: boolean; sub?: 'returned' | 'snoozed' }
type Item = { id: string; title: string; project: string; updated: number }

// Sections in display order. `sessions` is expected newest first. A query searches every place, archived included;
// archive view lists archived threads only.
// groupBy 'project' lists active threads under their project (projects ordered by their newest thread), 'date' by day buckets
export function buildSections<T extends Item>(sessions: T[], states: ThreadMap, now: number, query: string, archiveView: boolean, groupBy: 'date' | 'project' = 'date'): Section<T>[] {
  const q = query.trim().toLowerCase()
  const rows = sessions.filter((s) => !q || `${s.title} ${s.project}`.toLowerCase().includes(q))
  const at = (s: T) => place(states[s.id], now)
  const of = (p: Place) => rows.filter((s) => at(s) === p)

  if (archiveView) return [{ key: 'archived', label: 'Archived', items: of('archived').sort((a, b) => states[b.id].archivedAt! - states[a.id].archivedAt!) }]

  const out: Section<T>[] = []
  const add = (key: string, label: string, items: T[], extra: Partial<Section<T>> = {}) => { if (items.length) out.push({ key, label, items, ...extra }) }

  add('pinned', 'Pinned', of('pinned').sort((a, b) => states[b.id].pinned! - states[a.id].pinned!))
  add('snoozed', 'Snoozed', of('snoozed').sort((a, b) => states[a.id].snoozedUntil! - states[b.id].snoozedUntil!), { fold: true, sub: 'snoozed' })
  add('returned', 'Returned', of('returned').sort((a, b) => states[b.id].snoozedUntil! - states[a.id].snoozedUntil!), { sub: 'returned' })
  const dated: Section<T>[] = []
  if (groupBy === 'project') {
    const by = new Map<string, Section<T>>()
    for (const s of of('active')) {
      const name = s.project || 'Other'
      if (!by.has(name)) { const sec: Section<T> = { key: `project:${name}`, label: name, items: [] }; by.set(name, sec); dated.push(sec) }
      by.get(name)!.items.push(s)
    }
  } else {
    for (const s of of('active')) {
      const b = bucket(s.updated, now)
      if (dated.at(-1)?.label !== b) dated.push({ key: b, label: b, items: [] })
      dated.at(-1)!.items.push(s)
    }
  }
  out.push(...dated)
  add('closed', 'Closed', of('closed').sort((a, b) => states[b.id].closedAt! - states[a.id].closedAt!), { fold: true })
  // a search lists archived matches too, last
  if (q) add('archived', 'Archived', of('archived').sort((a, b) => states[b.id].archivedAt! - states[a.id].archivedAt!))
  return out
}

// ---- storage: ~/.claude/hive-threads.json through the main process, so dev and built Hive share it ----

const KEY = 'hive.threads' // the old browser-storage key, read once to carry earlier state over
let cache: ThreadMap = read()
const listeners = new Set<() => void>()

function read(): ThreadMap {
  try {
    const v = window.api.uiLoad('threads') as ThreadMap
    if (Object.keys(v).length) return v
    const old = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (old && typeof old === 'object' && !Array.isArray(old) && Object.keys(old).length) {
      window.api.uiSave('threads', old)
      return old
    }
  } catch { /* nothing saved yet */ }
  return {}
}

function write(next: ThreadMap) {
  cache = next
  try { window.api.uiSave('threads', next) } catch { /* in-memory only */ }
  listeners.forEach((l) => l())
}

// merge a patch into one thread; an undefined field removes it, and an empty record is dropped
export function patchThread(id: string, patch: { [K in keyof ThreadState]: ThreadState[K] | undefined }) {
  const merged: Record<string, number | undefined> = { ...cache[id], ...patch }
  const s = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as ThreadState
  const { [id]: _old, ...rest } = cache
  write(Object.keys(s).length ? { ...rest, [id]: s } : rest)
}

export const pin = (id: string, on: boolean) => patchThread(id, { pinned: on ? Date.now() : undefined })
export const snooze = (id: string, until: number) => patchThread(id, { snoozedUntil: until, snoozedAt: Date.now() })
export const clearSnooze = (id: string) => { if (cache[id]?.snoozedUntil) patchThread(id, { snoozedUntil: undefined, snoozedAt: undefined }) }
// Closing or archiving a thread (menu, bulk bar, or Claude's organize_thread) also deletes the worktrees it made;
// the app registers that here. Closing only the tab never comes through this.
let onRetire: ((id: string) => void) | null = null
export const setRetireHandler = (fn: ((id: string) => void) | null) => { onRetire = fn }

export const reopen = (id: string) => { if (cache[id]?.closedAt) patchThread(id, { closedAt: undefined }) }
export const close = (id: string, on: boolean) => { patchThread(id, { closedAt: on ? Date.now() : undefined }); if (on) onRetire?.(id) }
export const archive = (id: string, on: boolean) => { patchThread(id, { archivedAt: on ? Date.now() : undefined }); if (on) onRetire?.(id) }

// Claude's organize_thread call: the same store functions the menu uses. `until` is an ISO string, already checked in main.
export function organize(id: string, action: string, until?: string) {
  switch (action) {
    case 'pin': return pin(id, true)
    case 'unpin': return pin(id, false)
    case 'snooze': {
      const t = until ? new Date(until).getTime() : NaN
      return Number.isFinite(t) ? snooze(id, t) : undefined
    }
    case 'unsnooze': return clearSnooze(id)
    case 'close': return close(id, true)
    case 'reopen': return close(id, false)
    case 'archive': return archive(id, true)
    case 'unarchive': return archive(id, false)
  }
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }

export function useThreads(): ThreadMap {
  return useSyncExternalStore(subscribe, () => cache)
}
