// Five-field cron expressions (minute hour day-of-month month day-of-week), as the session's
// CronCreate / ScheduleWakeup / /loop jobs report them: when a job fires next (local time) and a short label.
// Pure, so it can be tested without Electron.

type Field = { any: boolean; set: Set<number> }

const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]

function parseField(src: string, [lo, hi]: [number, number]): Field | null {
  const set = new Set<number>()
  for (const part of src.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/)
    if (!m) return null
    const step = m[2] ? Number(m[2]) : 1
    if (step < 1) return null
    let a = lo, b = hi
    if (m[1] !== '*') {
      const [x, y] = m[1].split('-').map(Number)
      a = x
      b = y ?? (m[2] ? hi : x) // "5/15" means from 5 to the top, every 15
    }
    if (a < lo || b > hi || a > b) return null
    for (let v = a; v <= b; v += step) set.add(v)
  }
  // "any" as cron's own star flag: a field that starts with "*" ("*", "*/2") does not restrict the day on its own
  return { any: src.startsWith('*'), set }
}

export type Cron = { minute: Field; hour: Field; dom: Field; month: Field; dow: Field }

export function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const f = parts.map((p, i) => parseField(p, RANGES[i]))
  if (f.some((x) => !x)) return null
  const [minute, hour, dom, month, dow] = f as Field[]
  if (dow.set.has(7)) dow.set.add(0) // 7 is Sunday too
  return { minute, hour, dom, month, dow }
}

// standard cron: when both day fields are restricted, either one matching is enough; when one starts with "*"
// ("*" or a step such as "*/2") both must match ("0 0 */2 * 1" is every Monday that falls on an odd day)
function dayMatches(c: Cron, d: Date): boolean {
  const dom = c.dom.set.has(d.getDate())
  const dow = c.dow.set.has(d.getDay())
  return c.dom.any || c.dow.any ? dom && dow : dom || dow
}

// the first minute strictly after `from` that the expression matches, in local time; null if invalid or never
export function nextRun(expr: string, from: Date): Date | null {
  const c = parseCron(expr)
  if (!c) return null
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = from.getTime() + 5 * 366 * 86_400_000
  while (d.getTime() <= limit) {
    if (!c.month.set.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue }
    if (!dayMatches(c, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue }
    if (!c.hour.set.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue }
    if (!c.minute.set.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue }
    return d
  }
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')
const only = (f: Field) => (f.set.size === 1 ? [...f.set][0] : null)
// "*/5" style: every n starting at 0 over the whole range. Only a step that divides the range (60 minutes, 24 hours)
// is an even "every n": "*/90" minutes fires at :00 only, "*/7" restarts at each hour
const everyN = (src: string, range: number) => {
  const n = Number(src.match(/^\*\/(\d+)$/)?.[1])
  return n > 0 && n < range && range % n === 0 ? n : null
}

// a short label: "every minute", "every 5m", "every 2h", "every 2h at :05", "hourly at :15", "daily at 9:00", else the expression
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  const c = parseCron(expr)
  if (!c) return expr
  const [mi, ho, dom, mo, dow] = parts
  const daily = dom === '*' && mo === '*' && dow === '*'
  if (daily && ho === '*') {
    if (mi === '*' || mi === '*/1') return 'every minute'
    const n = everyN(mi, 60)
    if (n) return `every ${n}m`
    const m = only(c.minute)
    if (m !== null) return `hourly at :${pad(m)}`
  }
  if (daily && only(c.minute) !== null) {
    const n = everyN(ho, 24)
    if (n) return only(c.minute) === 0 ? `every ${n}h` : `every ${n}h at :${pad(only(c.minute)!)}`
    const h = only(c.hour)
    if (h !== null) return `daily at ${h}:${pad(only(c.minute)!)}`
  }
  return expr
}

// "45s", "3m 10s", "2h 5m", "3d 4h"
export function untilText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
