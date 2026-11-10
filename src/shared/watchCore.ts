// Scheduling logic shared by every watcher (watchersCore.ts): intervals, adaptive usage tiers, report slots, which run
// is due, findings. No I/O, so it can be tested without Electron.
import { lastSlot, parseTime } from './dependabotCore'

export type RunKind = 'sweep' | 'daily' | 'weekly'
export type WatchConfig = {
  dir: string // the watch folder: prompt file, memory/, reports/, findings.jsonl
  prompt: string // the prompt file, read fresh for every run
  cwd: string // the thread's working folder ('' = the workspace root)
  everyMs: number | null // fixed sweep interval; null = no sweeps (ignored when tiers is set)
  tiers: Tier[] | null // adaptive: the sweep interval follows the 7-day usage limit; null = fixed everyMs
  daily: string | null // HH:MM local, null = no daily report
  weekly: { day: number; time: string } | null // day 0 = Sunday
}
export type WatchState = {
  enabled: boolean
  since: number | null // when Watch first ran here: report slots before this are not "missed"
  last: Record<RunKind, number | null> // start time of the latest run that counted for each kind
}

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MIN = 60_000

// "60m", "2h", "90s", "1d"; "off" / "0" = none
export function parseEvery(v: string): number | null | undefined {
  const t = v.trim().toLowerCase()
  if (t === 'off' || t === '0' || t === 'none') return null
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/)
  if (!m) return undefined
  const ms = Number(m[1]) * { s: 1000, m: MIN, h: 60 * MIN, d: 24 * 60 * MIN }[m[2] as 's' | 'm' | 'h' | 'd']
  return ms > 0 ? ms : null
}

// The shortest sweep interval. Every sweep is a whole Claude session, and "1s" used to be accepted: a run on every
// scheduler tick. A schedule that asks for less is refused when it is saved (tooShort); one already on disk is read
// as this floor (atLeastMin), never thrown away.
export const MIN_EVERY_MS = 5 * MIN
export const MIN_EVERY_TEXT = '5m'
export const tooShort = (ms: number | null | undefined): boolean => typeof ms === 'number' && ms < MIN_EVERY_MS
export const atLeastMin = (ms: number | null): number | null => (ms === null ? null : Math.max(ms, MIN_EVERY_MS))

// adaptive sweeps: below `below` % of the weekly limit, sweep every `everyMs` (null = no sweeps in that tier)
export type Tier = { below: number; everyMs: number | null }
export const DEFAULT_TIERS = '50:1h,60:3h,70:6h,100:1d'

// "50:1h,60:3h,70:6h,100:1d": thresholds must rise, each between 1 and 100; intervals like parseEvery, none under the
// floor. clamp (reading a table already saved): a too-short interval becomes the floor instead of a problem
export function parseTiers(v: string, clamp = false): { tiers: Tier[] | null; problem: string } {
  const parts = v.split(',').map((x) => x.trim()).filter(Boolean)
  if (!parts.length) return { tiers: null, problem: 'no tiers' }
  const tiers: Tier[] = []
  for (const p of parts) {
    const m = p.match(/^(\d+(?:\.\d+)?)\s*%?\s*:\s*(.+)$/)
    if (!m) return { tiers: null, problem: `${p} is not like 50:1h` }
    const below = Number(m[1])
    if (!(below > 0 && below <= 100)) return { tiers: null, problem: `${p}: the threshold must be between 1 and 100` }
    const everyMs = parseEvery(m[2])
    if (everyMs === undefined) return { tiers: null, problem: `${p}: ${m[2]} is not like 60m, 2h, 1d or off` }
    if (tooShort(everyMs) && !clamp) return { tiers: null, problem: `${p}: the shortest interval is ${MIN_EVERY_TEXT}` }
    if (tiers.length && below <= tiers[tiers.length - 1].below) return { tiers: null, problem: `${p}: thresholds must rise` }
    tiers.push({ below, everyMs: atLeastMin(everyMs) })
  }
  return { tiers, problem: '' }
}

// the tier for this weekly use: the first whose threshold is above it, the last one at or above every threshold;
// unknown use (null) takes the slowest tier ("off" counts as slowest)
export type Pick = { everyMs: number | null; pct: number | null; tier: number }
export function pickTier(tiers: Tier[], pct: number | null): Pick {
  if (pct === null || !Number.isFinite(pct)) {
    let slow = 0
    tiers.forEach((t, i) => { if ((t.everyMs ?? Infinity) >= (tiers[slow].everyMs ?? Infinity)) slow = i })
    return { everyMs: tiers[slow].everyMs, pct: null, tier: slow }
  }
  const i = tiers.findIndex((t) => pct < t.below)
  const tier = i === -1 ? tiers.length - 1 : i
  return { everyMs: tiers[tier].everyMs, pct, tier }
}

// "Mon 08:00" (any day name of three letters or more)
export function parseWeekly(v: string): { day: number; time: string } | null {
  const m = v.trim().toLowerCase().match(/^([a-z]{3,})\s+(\d{1,2}:\d{2})$/)
  if (!m) return null
  const day = DAYS.indexOf(m[1].slice(0, 3))
  return day >= 0 && parseTime(m[2]) ? { day, time: m[2] } : null
}

// the latest weekly slot at or before now, in local time
export function lastWeeklySlot(now: Date, day: number, time: string): Date {
  const s = lastSlot(now, time) // today's slot if passed, else yesterday's
  while (s.getDay() !== day) s.setDate(s.getDate() - 1)
  return s
}

// a report slot is missed when the latest one passed after the last such run (or after Watch started here)
const missed = (slot: Date, last: number | null, since: number | null) => {
  const ref = last ?? since
  return ref !== null && ref < slot.getTime()
}

// which run should start now, if any: the biggest one due; nothing while the previous run still works
export function dueKind(now: Date, c: WatchConfig, s: WatchState, running: boolean): RunKind | null {
  if (!s.enabled || running) return null
  if (c.weekly && missed(lastWeeklySlot(now, c.weekly.day, c.weekly.time), s.last.weekly, s.since)) return 'weekly'
  if (c.daily && missed(lastSlot(now, c.daily), s.last.daily, s.since)) return 'daily'
  if (c.everyMs && (s.last.sweep === null || now.getTime() - s.last.sweep >= c.everyMs)) return 'sweep'
  return null
}

// a run started: a weekly run stands in for that day's daily report and a sweep, a daily one for a sweep
export function markStarted(s: WatchState, kind: RunKind, at: number): WatchState {
  const last = { ...s.last, sweep: at }
  if (kind !== 'sweep') last.daily = at
  if (kind === 'weekly') last.weekly = at
  return { ...s, since: s.since ?? at, last }
}

export type NextRuns = Record<RunKind, number | null>
export function nextRuns(now: Date, c: WatchConfig, s: WatchState): NextRuns {
  const day = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.getTime() }
  const report = (slot: Date, step: number, last: number | null) => (missed(slot, last, s.since) ? now.getTime() : day(slot, step))
  return {
    sweep: c.everyMs ? Math.max(now.getTime(), (s.last.sweep ?? 0) + c.everyMs) : null,
    daily: c.daily ? report(lastSlot(now, c.daily), 1, s.last.daily) : null,
    weekly: c.weekly ? report(lastWeeklySlot(now, c.weekly.day, c.weekly.time), 7, s.last.weekly) : null,
  }
}

export function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
}

export type Finding = { at: string; title: string; why: string; kind: string; link?: string }

// findings.jsonl, newest first; lines that are not a finding object are skipped
export function parseFindings(text: string): Finding[] {
  const out: Finding[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line)
      if (j && typeof j === 'object' && typeof j.title === 'string')
        out.push({ at: String(j.at ?? ''), title: j.title, why: String(j.why ?? ''), kind: String(j.kind ?? 'info'), ...(j.link ? { link: String(j.link) } : {}) })
    } catch { /* a half-written or hand-edited line */ }
  }
  return out.reverse()
}
