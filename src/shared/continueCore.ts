// Auto-continue after a usage limit: when the reset is, and when each waiting thread wakes. Pure, so it is tested.
export const CONTINUE_PROMPT = 'The usage limit has reset. Continue where you left off.'
export const AFTER_RESET_MS = 60_000 // a minute after the reset
export const STAGGER_MS = 3 * 60_000 // threads wake a few minutes apart, not all at once
// key: the Claude session id; since: when it was scheduled; kind: the limit that stopped it (rate_limit_event's type)
export type Wake = { key: string; tabId: string; cwd: string; title: string; at: number; since?: number; kind?: string }

// The reset time from the limit message, when the rate-limit event gave none: "...|1730000000" (unix seconds),
// "resets 3pm" / "resets 3:30 pm" (the next such local time), or with a date, as the weekly limit says it:
// "resets Nov 12, 3pm" / "resets Nov 12 at 3pm" (the next such date). null = no time in it.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export function resetFromText(text: string, now: number): number | null {
  const unix = text.match(/\|(\d{10})\b/)
  if (unix) return Number(unix[1]) * 1000
  const m = text.match(/resets?\s+(?:on\s+)?(?:([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*\(([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+|UTC)\))?/i)
  if (!m) return null
  let h = Number(m[3]) % 12
  if (m[5].toLowerCase() === 'pm') h += 12
  const min = Number(m[4] ?? 0)
  // a date in the message: that day, this year or (when it has passed) the next
  const month = m[1] ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1
  if (m[1] && month < 0) return null // "resets Monday 3pm": not a date this reads
  const day = m[1] ? Number(m[2]) : 0
  // the time is in the zone the message names ("resets 3pm (America/Chicago)"), else this computer's
  const zone = m[6] && validZone(m[6]) ? m[6] : null
  if (!zone) {
    const d = new Date(now)
    if (m[1]) {
      for (const y of [d.getFullYear(), d.getFullYear() + 1]) {
        const at = new Date(y, month, day, h, min, 0, 0)
        if (at.getMonth() === month && at.getTime() > now) return at.getTime()
      }
      return null
    }
    d.setHours(h, min, 0, 0)
    if (d.getTime() <= now) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  const today = wall(now, zone)
  const days: [number, number, number][] = m[1] ? [[today.y, month, day], [today.y + 1, month, day]] : [[today.y, today.mo, today.d], [today.y, today.mo, today.d + 1]]
  for (const [y, mo, d] of days) {
    const guess = Date.UTC(y, mo, d, h, min)
    // the instant whose wall clock in that zone reads h:min: try the zone's offset on both sides of a DST change and
    // keep those that land on h:min; a time that happens twice (fall back) takes the later one, so a continue is never
    // early; a time that never happens (spring forward) takes the later candidate, just after the change
    const offs = [zoneOffset(guess - 12 * 3_600_000, zone), zoneOffset(guess + 12 * 3_600_000, zone)]
    const hits = offs.map((o) => guess - o).filter((t) => { const w = wall(t, zone); return w.h === h && w.mi === min })
    const at = Math.max(...(hits.length ? hits : offs.map((o) => guess - o)))
    if (at > now) return at
  }
  return null
}

const validZone = (z: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true } catch { return false } }
function wall(t: number, zone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(t).map((x) => [x.type, x.value]))
  return { y: Number(p.year), mo: Number(p.month) - 1, d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) }
}
// how far the zone's wall clock is ahead of UTC at t
function zoneOffset(t: number, zone: string): number {
  const w = wall(t, zone)
  return Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000
}

// when this thread wakes: a minute after the reset, and at least STAGGER_MS after every other waiting thread's wake
// that is near it (the others keep their times)
export function planWake(resetAt: number, others: number[], now: number): number {
  let at = Math.max(resetAt + AFTER_RESET_MS, now + AFTER_RESET_MS)
  for (const o of [...others].sort((a, b) => a - b)) if (Math.abs(o - at) < STAGGER_MS) at = o + STAGGER_MS
  return at
}

// wakes due at start-up (Hive was closed at their time) go out spaced too, the first a minute after start
export function catchUp(wakes: Wake[], now: number): Wake[] {
  let next = now + AFTER_RESET_MS
  return [...wakes].sort((a, b) => a.at - b.at).map((w) => {
    if (w.at > next) return w
    const at = next
    next += STAGGER_MS
    return { ...w, at }
  })
}

// the limit came back early: a turn that started after a wake was scheduled went through. Only the plan-wide windows
// are proven back by that (a per-model weekly limit is not: a Sonnet turn says nothing about Opus). Those wakes go a
// minute from now, spaced; a wake only ever moves earlier, so repeated successes never push one back. A wake already
// due soon (moved by an earlier success) keeps its slot, and the next one goes a STAGGER_MS after it
const GENERAL = new Set([undefined, 'five_hour', 'seven_day'])
export function wakeNow(wakes: Wake[], now: number, turnStartedAt: number): Wake[] {
  let next = now + AFTER_RESET_MS
  return [...wakes].sort((a, b) => a.at - b.at).map((w) => {
    if (w.at <= next) { next = Math.max(next, w.at + STAGGER_MS); return w }
    if (!GENERAL.has(w.kind) || (w.since ?? 0) >= turnStartedAt) return w
    const at = next
    next += STAGGER_MS
    return { ...w, at }
  })
}

// "3:41 PM", with the weekday when not today
export function wakeLabel(at: number, now: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}
