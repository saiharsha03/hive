// Auto-continue after a usage limit: when the reset is, and when each waiting thread wakes. Pure, so it is tested.
export const CONTINUE_PROMPT = 'The usage limit has reset. Continue where you left off.'
export const AFTER_RESET_MS = 60_000 // a minute after the reset
export const STAGGER_MS = 3 * 60_000 // threads wake a few minutes apart, not all at once
export type Wake = { key: string; tabId: string; cwd: string; title: string; at: number } // key: the Claude session id

// The reset time from the limit message, when the rate-limit event gave none: "...|1730000000" (unix seconds) or
// "resets 3pm" / "resets 3:30 pm" (the next such local time). null = no time in it.
export function resetFromText(text: string, now: number): number | null {
  const unix = text.match(/\|(\d{10})\b/)
  if (unix) return Number(unix[1]) * 1000
  const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'pm') h += 12
  const d = new Date(now)
  d.setHours(h, Number(m[2] ?? 0), 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
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

// "3:41 PM", with the weekday when not today
export function wakeLabel(at: number, now: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}
