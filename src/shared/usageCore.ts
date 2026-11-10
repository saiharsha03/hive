// A placeholder usage answer (what an idle process, or a rate-limited usage endpoint, gives): 5 h at 0 with no reset
// time. It is not a reading, so it never replaces a real one (the status bar sat at 0% while the session was at 37%).
// A plan without a 5-hour window (some personal plans) is a reading when a weekly window has a reset time (the
// placeholder never has one); before this the meters hid for good on such a plan. The same holds when the 5-hour
// window is there but idle: the weekly number in that answer is real (adaptive watchers read it).
const WEEKS = ['seven_day', 'seven_day_sonnet', 'seven_day_opus']
export const realLimits = (l: any): boolean => {
  if (!l) return false
  if (l.five_hour && !(l.five_hour.utilization === 0 && !l.five_hour.resets_at)) return true
  // no 5-hour window, or an idle one (0 with no reset time, which a real answer also gives between sessions): a
  // weekly window with a reset time still makes it a reading
  return WEEKS.some((k) => typeof l[k]?.utilization === 'number' && !!l[k].resets_at)
}

// The plan limits as /usage lists them: the 5-hour session, the week for all models, then per-model weeks.
// Only windows with a reading; a placeholder answer gives none.
export type UsageRow = { key: string; label: string; pct: number; resetsAt: string | null }
const WINDOWS: [string, string][] = [['five_hour', 'Current session (5 hours)'], ['seven_day', 'Current week (all models)'], ['seven_day_sonnet', 'Current week (Sonnet)'], ['seven_day_opus', 'Current week (Opus)']]
export function usageRows(l: any, now = Date.now()): UsageRow[] {
  if (!realLimits(l)) return []
  return WINDOWS.flatMap(([key, label]) => {
    const w = l[key]
    return typeof w?.utilization === 'number' ? [afterReset({ key, label, pct: w.utilization, resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null }, now)] : []
  })
}

// A kept reading outlives its window: once the reset time has passed, that window is back at 0 (the bar sat on
// the old 5-hour number for hours after the reset when no thread was talking to the API).
export function afterReset<T extends { pct: number | null; resetsAt: string | null }>(w: T, now = Date.now()): T {
  return w.resetsAt && Date.parse(w.resetsAt) <= now ? { ...w, pct: 0, resetsAt: null } : w
}
