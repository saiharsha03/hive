// Thread places (pin, snooze, close, archive) shared by the desktop sidebar and the phone list Hive main builds.
export type ThreadState = { pinned?: number; snoozedUntil?: number; snoozedAt?: number; closedAt?: number; archivedAt?: number }
export type ThreadMap = Record<string, ThreadState>
export type Place = 'pinned' | 'returned' | 'active' | 'snoozed' | 'closed' | 'archived'

// where a thread sits; pinned wins unless archived, and a snooze only hides a thread until it comes due
export function place(s: ThreadState | undefined, now: number): Place {
  if (!s) return 'active'
  if (s.archivedAt) return 'archived'
  if (s.pinned) return 'pinned'
  if (s.closedAt) return 'closed'
  if (s.snoozedUntil) return s.snoozedUntil > now ? 'snoozed' : 'returned'
  return 'active'
}

const DAY = 86_400_000
// "Tue 9 AM", with the date when it is more than a week out; ":30" only when needed
export function untilLabel(t: number, now: number): string {
  const d = new Date(t)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined })
  if (d.toDateString() === new Date(now).toDateString()) return time
  if (t - now > 6 * DAY) return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}

// a watcher's row: when it runs next ('' when unknown)
export const nextRunLabel = (w: { enabled?: boolean; nextRun?: number | null }, now: number) => (w.enabled === false ? 'off' : w.nextRun ? `next run ${untilLabel(w.nextRun, now)}` : '')

// ---- the phone's thread list, in the sidebar's sections ----

export type PhoneSection = 'watchers' | 'pinned' | 'waiting' | 'working' | 'dependabot' | 'recent'
export const PHONE_SECTIONS: readonly PhoneSection[] = ['watchers', 'pinned', 'waiting', 'working', 'dependabot', 'recent']
export type PhoneThread = { id: string; title: string; folder: string; state: 'working' | 'waiting' | 'idle'; note: string; updated: number; section: PhoneSection }
export type PhoneLive = { tabId: string; sessionId: string | null; title: string; folder: string; busy: boolean; waitingReason?: string }
export type PhoneSaved = { id: string; title: string; project: string; updated: number; watcherRun?: boolean; dependabot?: boolean }
export type PhoneWatcher = { name: string; tabId: string | null; sessionId: string | null; sessionIds?: string[]; enabled?: boolean; nextRun?: number | null }

// Same rules as the sidebar: a watcher's row is its latest run (with its current run's live state), older runs and
// other watcher runs stay out; a working or waiting thread sits in Working / Waiting whatever its pin; the rest are
// Pinned or Recent, and closed, archived and still-snoozed threads are left out. Returned in section order.
export function phoneThreads(live: PhoneLive[], saved: PhoneSaved[], watchers: PhoneWatcher[], states: ThreadMap, now: number, recentMax = 40): PhoneThread[] {
  const latest = (w: PhoneWatcher) => w.sessionId ?? w.sessionIds?.at(-1) ?? null
  const runs = new Set(watchers.flatMap((w) => [...(w.sessionIds ?? []), ...(w.sessionId ? [w.sessionId] : [])]))
  const latestIds = new Set(watchers.flatMap((w) => { const id = latest(w); return id ? [id] : [] }))
  const currentTabs = new Set(watchers.flatMap((w) => (w.tabId ? [w.tabId] : [])))
  const isWatcherLive = (t: PhoneLive) => currentTabs.has(t.tabId) || latestIds.has(t.sessionId ?? '') || latestIds.has(t.tabId)
  // a question for the user wins over busy, as in the sidebar's Waiting for you
  const stateOf = (t: PhoneLive): PhoneThread['state'] => (t.waitingReason ? 'waiting' : t.busy ? 'working' : 'idle')
  const savedById = new Map(saved.map((s) => [s.id, s]))
  // Dependabot review threads (running or saved) get their own section, as in the sidebar
  const bot = (tabId: string, sessionId: string | null) => tabId.startsWith('dependabot-') || !!savedById.get(sessionId ?? tabId)?.dependabot
  const out: PhoneThread[] = []

  for (const w of watchers) {
    const id = latest(w)
    const t = live.find((l) => (w.tabId && l.tabId === w.tabId) || (id && l.sessionId === id))
    const s = id ? savedById.get(id) : undefined
    if (!t && !s) continue
    out.push({ id: t?.tabId ?? id!, title: w.name, folder: t?.folder ?? s!.project, state: t ? stateOf(t) : 'idle', note: t?.waitingReason || nextRunLabel(w, now), updated: s?.updated ?? now, section: 'watchers' })
  }

  // a watcher tab with no session yet is a run that just started; it is shown under its watcher above
  const others = live.filter((t) => !isWatcherLive(t) && (!t.tabId.startsWith('watcher-') || t.sessionId))
  const liveIds = new Set(live.flatMap((t) => [t.tabId, t.sessionId ?? '']))
  const keep = (key: string): 'pinned' | 'recent' | null => { const p = place(states[key], now); return p === 'pinned' ? 'pinned' : p === 'active' || p === 'returned' ? 'recent' : null }
  const rest: PhoneThread[] = []
  for (const t of others) {
    const st = stateOf(t)
    if (st === 'idle' && runs.has(t.sessionId ?? '')) continue // an older watcher run open but idle: out of the list, as in the sidebar
    const kept = st === 'idle' ? keep(t.sessionId ?? t.tabId) : st
    const section = kept && kept !== 'pinned' && bot(t.tabId, t.sessionId) ? 'dependabot' : kept
    if (section) (st === 'idle' ? rest : out).push({ id: t.tabId, title: t.title, folder: t.folder, state: st, note: t.waitingReason ?? '', updated: now, section })
  }
  let recent = 0, bots = 0 // Recent and Dependabot each hold up to recentMax
  for (const s of saved) {
    if (liveIds.has(s.id) || s.watcherRun || runs.has(s.id)) continue
    const kept = keep(s.id)
    const section = kept === 'recent' && s.dependabot ? 'dependabot' : kept
    if (!section || (section === 'recent' && ++recent > recentMax) || (section === 'dependabot' && ++bots > recentMax)) continue
    rest.push({ id: s.id, title: s.title, folder: s.project, state: 'idle', note: '', updated: s.updated, section })
  }
  const pinAt = (t: PhoneThread) => states[t.id]?.pinned ?? states[live.find((l) => l.tabId === t.id)?.sessionId ?? '']?.pinned ?? 0
  const order = (t: PhoneThread) => PHONE_SECTIONS.indexOf(t.section)
  // stable sort: live threads keep their order, saved ones stay newest first; pinned newest pin first like the sidebar
  return [...out, ...rest].sort((a, b) => order(a) - order(b) || (a.section === 'pinned' ? pinAt(b) - pinAt(a) : 0))
}
