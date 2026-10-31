// Input check for the organize_thread tool; pure so it can be tested without Electron.
export const ORGANIZE_ACTIONS = ['pin', 'unpin', 'snooze', 'unsnooze', 'close', 'reopen', 'archive', 'unarchive', 'waiting'] as const
export type OrganizeAction = (typeof ORGANIZE_ACTIONS)[number]

export const REASON_MAX = 140

// waiting takes an optional one-line reason; snooze needs a future ISO datetime; other actions ignore both. Returns the normalised ISO string for snooze.
export function checkOrganize(action: OrganizeAction, until: string | undefined, now = Date.now(), reason?: string): { ok: true; until?: string; reason?: string } | { ok: false; error: string } {
  if (action === 'waiting') {
    const r = reason?.trim()
    if (r && r.length > REASON_MAX) return { ok: false, error: `reason is ${r.length} characters; keep it to one line of at most ${REASON_MAX}` }
    return { ok: true, reason: r || undefined }
  }
  if (action !== 'snooze') return { ok: true }
  if (!until) return { ok: false, error: 'snooze needs "until", an ISO datetime such as 2026-10-31T09:00:00' }
  const t = new Date(until).getTime()
  if (!Number.isFinite(t)) return { ok: false, error: `"${until}" is not a valid ISO datetime` }
  if (t <= now) return { ok: false, error: `"${until}" is not in the future (it is now ${new Date(now).toISOString()})` }
  return { ok: true, until: new Date(t).toISOString() }
}

// "Friday 2026-10-30 14:05 (UTC-04:00)": the user's local clock, so Claude can resolve "tomorrow"
export function localNow(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off < 0 ? '-' : '+'
  const day = d.toLocaleDateString('en-US', { weekday: 'long' })
  return `${day} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (UTC${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)})`
}
