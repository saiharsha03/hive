// Pure logic for the Running and Scheduled pages: which tasks show, the trail, the schedule rows and the 24-hour
// timeline's placement. No React, no Electron, so it is tested alone.
import { clock, dur } from '../kit'

// ---- Running ----
export type TaskLike = {
  id: string; kind: string; title: string; status: 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: number; endedAt?: number; now?: string; lastTool?: string; summary?: string; error?: string; durationMs?: number
}
export type RunRow<T extends TaskLike = TaskLike> = { tabId: string; thread: string; task: T }

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'local_agent': return 'Subagent'
    case 'local_bash': return 'Shell'
    case 'monitor': case 'local_monitor': return 'Monitor'
    case 'local_workflow': return 'Workflow'
    case 'codex': return 'Codex'
    default: return kind ? kind.replace(/^local_/, '').replace(/^./, (c) => c.toUpperCase()) : 'Task'
  }
}

const HOUR = 3_600_000
// running first (oldest start first, so the long ones lead), then finished within the last hour, newest first
export function nowRows<T extends TaskLike>(rows: RunRow<T>[], now: number): RunRow<T>[] {
  const running = rows.filter((r) => r.task.status === 'running').sort((a, b) => a.task.startedAt - b.task.startedAt)
  const done = rows.filter((r) => r.task.status !== 'running' && (r.task.endedAt ?? r.task.startedAt) >= now - HOUR)
    .sort((a, b) => (b.task.endedAt ?? b.task.startedAt) - (a.task.endedAt ?? a.task.startedAt))
  return [...running, ...done]
}

// "6 working, 1 failed in the last 10 minutes"
export function nowNote(rows: RunRow[], now: number): string {
  const working = rows.filter((r) => r.task.status === 'running').length
  const failed = rows.filter((r) => r.task.status === 'failed' && (r.task.endedAt ?? 0) >= now - 600_000).length
  const parts: string[] = []
  if (working) parts.push(`${working} working`)
  if (failed) parts.push(`${failed} failed in the last 10 minutes`)
  return parts.join(', ')
}

export const lastOutput = (t: TaskLike): string => (t.status === 'running' ? (t.now || t.lastTool || '') : (t.error || t.summary || t.now || t.lastTool || '')).replace(/\s+/g, ' ').trim()

export type TrailEntry = { key: string; at: number; word: string; tone: 'work' | 'done' | 'fail' | 'idle'; text: string; detail: string }
// what started, finished or failed, newest first
export function trail(rows: RunRow[], limit = 12): TrailEntry[] {
  const out: TrailEntry[] = []
  for (const { thread, task: t } of rows) {
    const what = t.title || kindLabel(t.kind)
    out.push({ key: `${t.id}:start`, at: t.startedAt, word: 'STARTED', tone: 'work', text: `${what} started in ${thread}`, detail: '' })
    if (t.status !== 'running') {
      const at = t.endedAt ?? t.startedAt
      const took = dur(t.durationMs ?? Math.max(0, at - t.startedAt))
      const detail = (t.status === 'failed' ? (t.error || t.summary || '') : (t.summary || '')).replace(/\s+/g, ' ').trim()
      const verb = t.status === 'failed' ? 'failed' : t.status === 'stopped' ? 'stopped' : 'finished'
      out.push({
        key: `${t.id}:end`, at, word: t.status === 'failed' ? 'FAILED' : t.status === 'stopped' ? 'STOPPED' : 'DONE',
        tone: t.status === 'failed' ? 'fail' : t.status === 'stopped' ? 'idle' : 'done',
        text: `${what} ${verb} in ${thread}`, detail: detail ? `${detail}, ${took}` : took,
      })
    }
  }
  return out.sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : 1)).slice(0, limit)
}

// ---- Scheduled ----
export type SchedKind = 'WAKE-UP' | 'LOOP' | 'AUTO-CONTINUE' | 'WATCHER'
export type SchedRow = {
  key: string; kind: SchedKind; at: number | null; every: string | null // "every 10m" when it repeats on a period
  rel: string; thread: string; what: string; repeats: string
  tabId?: string; id?: string | number; recurring: boolean
}
export type SchedInput = {
  wakeups: { id: number; title: string; wakeAt: string; prompt: string; everyMinutes: number | null; firedAt: string | null }[]
  continues: { key: string; tabId: string; title: string; at: number }[]
  threads: { tabId: string; title: string; crons: { id: string; schedule: string; recurring: boolean; prompt: string }[]; nextWake: number | null }[]
  watchers: { id: string; name: string; goal: string; enabled: boolean; nextRun: number | null; every: string }[]
}

// a cron expression's period in ms for the common shapes (*/N minutes, hourly, */N hours), else null
export function cronPeriod(expr: string): number | null {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5 || f.slice(2).some((x) => x !== '*')) return null
  const [m, h] = f
  const stepM = /^\*\/(\d+)$/.exec(m)
  if (stepM && h === '*') return +stepM[1] * 60_000
  if (/^\d+$/.test(m) && h === '*') return HOUR
  const stepH = /^\*\/(\d+)$/.exec(h)
  if (/^\d+$/.test(m) && stepH) return +stepH[1] * HOUR
  return null
}
export function everyWord(ms: number): string {
  const m = Math.round(ms / 60_000)
  return m % 60 === 0 ? `${m / 60}h` : `${m}m`
}
const nextTick = (period: number, now: number) => Math.ceil((now + 1) / period) * period

const DAY = 86_400_000
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
// "today, in 33m", "tomorrow, in 14h 00m", "in 2 days"
export function relWord(at: number, now: number): string {
  const d = at - now
  const span = d < 60_000 ? 'under a minute' : dur(d)
  if (d > 2 * DAY) return `in ${Math.round(d / DAY)} days`
  if (sameDay(at, now)) return `today, in ${span}`
  if (sameDay(at, now + DAY)) return `tomorrow, in ${span}`
  return `in ${span}`
}
// the big time: 14:00, or "Thu 09:00" when it is not today or tomorrow
export function bigTime(at: number, now: number): string {
  if (sameDay(at, now) || sameDay(at, now + DAY)) return clock(at)
  return `${new Date(at).toLocaleDateString('en-GB', { weekday: 'short' })} ${clock(at)}`
}
const clip = (s: string, n = 90) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t }
const watcherEvery = (e: string) => (e === 'adaptive' ? 'adaptive' : e === 'self' ? 'it plans its own' : e === 'off' ? 'off' : `every ${e}`)

export function scheduleRows(i: SchedInput, now: number): SchedRow[] {
  const rows: SchedRow[] = []
  for (const w of i.wakeups) {
    const at = Date.parse(w.wakeAt)
    if (!Number.isFinite(at)) continue
    rows.push({
      key: `wake:${w.id}`, kind: 'WAKE-UP', at, every: null, rel: relWord(at, now), thread: w.title, what: clip(w.prompt),
      repeats: w.everyMinutes ? `every ${everyWord(w.everyMinutes * 60_000)}` : 'once', id: w.id, recurring: !!w.everyMinutes,
    })
  }
  for (const c of i.continues) {
    rows.push({ key: `cont:${c.key}`, kind: 'AUTO-CONTINUE', at: c.at, every: null, rel: relWord(c.at, now), thread: c.title, what: 'Pick up where the limit stopped it', repeats: 'once', tabId: c.tabId, id: c.key, recurring: false })
  }
  for (const t of i.threads) {
    for (const j of t.crons) {
      const p = cronPeriod(j.schedule)
      const at = p ? nextTick(p, now) : null
      rows.push({
        key: `loop:${t.tabId}:${j.id}`, kind: 'LOOP', at, every: p ? `every ${everyWord(p)}` : j.schedule,
        rel: at ? `next ${clock(at)}` : '', thread: t.title, what: clip(j.prompt), repeats: j.recurring ? 'until stopped' : 'once',
        tabId: t.tabId, id: j.id, recurring: j.recurring,
      })
    }
    if (t.nextWake && t.nextWake > now) {
      rows.push({ key: `selfwake:${t.tabId}`, kind: 'WAKE-UP', at: t.nextWake, every: null, rel: relWord(t.nextWake, now), thread: t.title, what: 'Its own wake-up, set by the thread', repeats: 'once', tabId: t.tabId, recurring: false })
    }
  }
  for (const w of i.watchers) {
    if (!w.enabled) continue
    rows.push({
      key: `watch:${w.id}`, kind: 'WATCHER', at: w.nextRun, every: null, rel: w.nextRun ? relWord(w.nextRun, now) : '', thread: w.name,
      what: clip(w.goal), repeats: watcherEvery(w.every), id: w.id, recurring: true,
    })
  }
  return rows.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || (a.key < b.key ? -1 : 1))
}

// ---- the 24-hour strip ----
export type TickIn = { key: string; kind: SchedKind; at: number; label: string; until?: number }
export type TickOut = TickIn & { x: number; band: number | null; row: number; clipped: boolean } // x and band end as 0..1 of the strip
export type Strip = { start: number; span: number; hours: { x: number; label: string }[]; nowX: number; ticks: TickOut[] }

export const TIMELINE_ROWS = 3
// start is the top of the current hour; events beyond +24h are left out. A label's width is estimated from its
// length against the strip's pixel width, and an event takes the first row whose last label ends before its tick.
export function layoutStrip(events: TickIn[], now: number, trackPx = 1100, rows = TIMELINE_ROWS): Strip {
  const start = Math.floor(now / HOUR) * HOUR
  const span = 24 * HOUR
  const hours = Array.from({ length: 24 }, (_, k) => ({ x: k / 24, label: clock(start + k * HOUR) }))
  const ends = Array<number>(rows).fill(-1)
  const ticks: TickOut[] = []
  for (const e of events.filter((ev) => ev.at >= start && ev.at < start + span).sort((a, b) => a.at - b.at)) {
    const x = (e.at - start) / span
    const w = (e.label.length * 6.4 + 16) / trackPx
    let row = ends.findIndex((end) => end <= x)
    const clipped = row < 0
    if (clipped) row = ends.indexOf(Math.min(...ends))
    ends[row] = x + w + 0.004
    const band = e.until ? Math.min(1, (e.until - start) / span) : null
    ticks.push({ ...e, x, band: band !== null && band > x ? band : null, row, clipped })
  }
  return { start, span, hours, nowX: (now - start) / span, ticks }
}

// the strip's events from the schedule rows: a loop is a tick at its next fire and a band to the strip's end
export function ticksOf(rows: SchedRow[], now: number): TickIn[] {
  const end = Math.floor(now / HOUR) * HOUR + 24 * HOUR
  return rows.flatMap((r) => (r.at === null ? [] : [{
    key: r.key, kind: r.kind, at: r.at,
    label: `${clock(r.at)} ${r.kind === 'LOOP' ? `Loop ${r.every ?? ''}`.trim() : r.kind === 'AUTO-CONTINUE' ? `Continue ${r.thread}` : r.thread}`,
    until: r.kind === 'LOOP' && r.recurring ? end : undefined,
  }]))
}
