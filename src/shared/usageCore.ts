// A placeholder usage answer (what an idle process, or a rate-limited usage endpoint, gives): 5 h at 0 with no reset
// time. It is not a reading, so it never replaces a real one (the status bar sat at 0% while the session was at 37%).
export const realLimits = (l: any): boolean => !!l?.five_hour && !(l.five_hour.utilization === 0 && !l.five_hour.resets_at)

// The plan limits as /usage lists them: the 5-hour session, the week for all models, then per-model weeks.
// Only windows with a reading; a placeholder answer gives none.
export type UsageRow = { key: string; label: string; pct: number; resetsAt: string | null }
const WINDOWS: [string, string][] = [['five_hour', 'Current session (5 hours)'], ['seven_day', 'Current week (all models)'], ['seven_day_sonnet', 'Current week (Sonnet)'], ['seven_day_opus', 'Current week (Opus)']]
export function usageRows(l: any): UsageRow[] {
  if (!realLimits(l)) return []
  return WINDOWS.flatMap(([key, label]) => {
    const w = l[key]
    return typeof w?.utilization === 'number' ? [{ key, label, pct: w.utilization, resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null }] : []
  })
}
