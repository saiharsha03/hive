// Hive's quiet hours (one setting with the phone app's: it reads and writes them here). During them the desktop
// notification for a thread comes without sound; a failure still rings, as on the phone. Kept in hive-quiet.json.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSafe } from './safeWrite'
import { dataDir } from './testMode'
import type { QuietHours } from '../shared/phoneCore'

export const DEFAULT_QUIET: QuietHours = { on: false, from: '22:00', to: '07:00' }
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/
const file = () => join(dataDir(), 'hive-quiet.json')

// a stored or sent value, made safe: bad times fall back to the default ones
export function normalizeQuiet(v: unknown): QuietHours {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const t = (x: unknown, d: string) => (typeof x === 'string' && HHMM.test(x.trim()) ? x.trim().padStart(5, '0') : d)
  return { on: o.on === true, from: t(o.from, DEFAULT_QUIET.from), to: t(o.to, DEFAULT_QUIET.to) }
}

// whether `now` (local time) falls in the quiet hours; a span that passes midnight (22:00 to 07:00) wraps
export function inQuiet(q: QuietHours, now: Date): boolean {
  if (!q.on) return false
  const min = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
  const at = now.getHours() * 60 + now.getMinutes()
  const from = min(q.from)
  const to = min(q.to)
  if (from === to) return true // the whole day
  return from < to ? at >= from && at < to : at >= from || at < to
}

export function quietHours(): QuietHours {
  try { return normalizeQuiet(JSON.parse(readFileSync(file(), 'utf8'))) } catch { return { ...DEFAULT_QUIET } }
}
export function setQuietHours(q: unknown): QuietHours {
  const v = normalizeQuiet(q)
  writeFileSafe(file(), JSON.stringify(v))
  return v
}
