// The plan's usage windows as the rail's gauges show them: how much is used, how much of the window's time has passed,
// and whether the spending is ahead of the clock. Pure, so it is tested.
export type UsageRow = { key: string; label: string; pct: number; resetsAt: string | null }
export type Gauge = { key: string; name: string; short: string; used: number; passed: number | null; ahead: boolean; resets: string; says: string }

const HOUR = 3_600_000
// the 5-hour window is five hours long; every other window the plan reports is a 7-day one
export const windowMs = (key: string): number => (key === 'five_hour' ? 5 * HOUR : 7 * 24 * HOUR)
export const limitName = (u: UsageRow): string =>
  u.key === 'five_hour' ? '5-hour' : u.key === 'seven_day' ? '7-day' : `7-day ${u.label.match(/\((.+)\)/)?.[1] ?? u.key.replace(/^(seven_day|model)_/, '')}`

// the day always said: today, tomorrow, a weekday within the week, else the date
export function resetWord(at: Date, now: Date): string {
  const day = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
  const days = Math.round((day(at) - day(now)) / 86_400_000)
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: at.getMinutes() ? '2-digit' : undefined })
  return days <= 0 ? `today ${time}` : days === 1 ? `tomorrow ${time}` : days < 7 ? `${at.toLocaleDateString([], { weekday: 'short' })} ${time}` : `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))
export function gaugeOf(u: UsageRow, now: number): Gauge {
  const at = u.resetsAt ? new Date(u.resetsAt) : null
  const left = at ? at.getTime() - now : NaN
  // time passed in the window, when its reset is known and lies ahead
  const passed = at && left > 0 && left <= windowMs(u.key) ? clamp((1 - left / windowMs(u.key)) * 100) : null
  const used = clamp(u.pct)
  // ahead of the clock by more than a sliver, or simply nearly out
  const ahead = used >= 90 || (passed !== null && used > passed + 5)
  const name = limitName(u)
  // under the gauge: 5h, 7d, or the model's first two letters for a per-model window
  const short = u.key === 'five_hour' ? '5h' : u.key === 'seven_day' ? '7d' : name.replace(/^7-day /, '').slice(0, 2)
  const resets = at ? resetWord(at, new Date(now)) : ''
  const pace = passed === null ? '' : `, ${Math.round(passed)}% of the window gone: ${ahead ? 'ahead of pace' : 'under pace'}`
  return { key: u.key, name, short, used, passed, ahead, resets, says: `${name}: ${Math.round(used)}% used${resets ? `, resets ${resets}` : ''}${pace}` }
}
