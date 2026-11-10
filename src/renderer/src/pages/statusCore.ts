// Pure logic for the Status and usage page and the account switcher: the limit forecast from successive readings,
// the context bar's segments, the MCP state words and the number and reset formats. No React, no Electron.
import { clock, dur, type Tone } from '../kit'

// ---- limit forecast ----
export type Reading = { at: number; pct: number }
const KEEP_MS = 3 * 3_600_000
const MAX_READINGS = 120

// add a reading; a drop in the percentage means the window reset, so the old readings go
export function addReading(list: Reading[], at: number, pct: number): Reading[] {
  const last = list.at(-1)
  if (last && pct < last.pct) return [{ at, pct }]
  if (last && last.at === at) return [...list.slice(0, -1), { at, pct }]
  return [...list, { at, pct }].filter((r) => r.at >= at - KEEP_MS).slice(-MAX_READINGS)
}

export type Forecast = { kind: 'ontrack' } | { kind: 'near' } | { kind: 'hit'; at: number }

// Percent per millisecond from the first to the last reading; needs two readings at least a minute apart.
// It reaches 100% before the reset => 'hit'. One reading only: 'near' above 90, otherwise on track.
export function forecast(readings: Reading[], resetsAt: number | null, now: number): Forecast {
  const last = readings.at(-1)
  if (!last) return { kind: 'ontrack' }
  if (last.pct >= 100) return { kind: 'hit', at: last.at }
  const first = readings[0]
  const span = last.at - first.at
  if (readings.length < 2 || span < 60_000) return last.pct > 90 ? { kind: 'near' } : { kind: 'ontrack' }
  const slope = (last.pct - first.pct) / span
  if (slope <= 0) return last.pct > 90 ? { kind: 'near' } : { kind: 'ontrack' }
  const at = Math.max(now, last.at + (100 - last.pct) / slope)
  if (resetsAt !== null && at >= resetsAt) return { kind: 'ontrack' }
  return { kind: 'hit', at }
}
export function forecastText(f: Forecast): string {
  if (f.kind === 'hit') return `At this rate you reach 100% at ${clock(f.at)}`
  return f.kind === 'near' ? 'Close to the limit' : 'On track'
}
export const forecastWarns = (f: Forecast): boolean => f.kind !== 'ontrack'

// "resets 15:00, in 1h 48m"
export function resetText(resetsAt: string | number | null | undefined, now: number): string {
  if (resetsAt == null) return ''
  const t = typeof resetsAt === 'number' ? resetsAt : Date.parse(resetsAt)
  if (!Number.isFinite(t)) return ''
  if (t <= now) return 'resets now'
  return `resets ${clock(t)}, in ${dur(t - now)}`
}
export const resetMs = (resetsAt: string | null | undefined): number | null => {
  if (!resetsAt) return null
  const t = Date.parse(resetsAt)
  return Number.isFinite(t) ? t : null
}
// which window a usage row is: the 5-hour, the 7-day, or another (a model's weekly row)
export function windowOf(label: string, key = ''): 'five' | 'seven' | 'other' {
  const s = `${key} ${label}`.toLowerCase()
  if (/5[- _]?h|five|session/.test(s)) return 'five'
  if (/7[- _]?d|seven|week/.test(s)) return 'seven'
  return 'other'
}

// ---- numbers ----
export const grouped = (n: number): string => Math.round(n).toLocaleString('en-US')
// 112k / 1M
export function shortSize(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}
export const contextShort = (total: number, max: number): string => (max > 0 ? `${shortSize(total)} / ${shortSize(max)}` : shortSize(total)) // max 0: the window size is not known (the thread is not running)
export function sinceText(at: number | null, now: number): string {
  if (at === null) return 'Not read yet'
  const s = Math.max(0, Math.round((now - at) / 1000))
  return `Live. Updated ${s} second${s === 1 ? '' : 's'} ago from the running threads`
}

// ---- context bar ----
export type Seg = { key: 'system' | 'memory' | 'messages' | 'used' | 'free'; label: string; pct: number }
// Segments as percentages of the window. With the parts: system and tools, memory, messages, free.
// Without them: what is used and what is free.
export function contextSegments(
  ctx: { total: number; max: number },
  parts?: { system: number; tools: number; memory: number; messages: number } | null,
): Seg[] {
  const max = Math.max(1, ctx.max)
  const p = (n: number) => Math.max(0, Math.min(100, (n / max) * 100))
  const used = Math.min(100, p(ctx.total))
  if (!parts) return [{ key: 'used', label: 'In use', pct: used }, { key: 'free', label: 'Free', pct: 100 - used }]
  const sys = p(parts.system + parts.tools)
  const mem = p(parts.memory)
  const msg = Math.max(0, Math.min(p(parts.messages), 100 - sys - mem))
  return [
    { key: 'system', label: 'System and tools', pct: sys },
    { key: 'memory', label: 'Memory', pct: mem },
    { key: 'messages', label: 'Messages', pct: msg },
    { key: 'free', label: 'Free', pct: Math.max(0, 100 - sys - mem - msg) },
  ]
}
// where the auto-compact tick sits, in percent of the window; null when unknown
export const compactTick = (at: number | null | undefined, max: number): number | null =>
  at && max > 0 ? Math.max(0, Math.min(100, (at / max) * 100)) : null

// ---- MCP ----
export function mcpState(status: string): { word: string; tone: Tone; action: 'signin' | 'retry' | null } {
  const s = status.toLowerCase()
  if (s === 'connected') return { word: 'CONNECTED', tone: 'done', action: null }
  if (s === 'needs-auth' || s === 'needs_auth' || s === 'needsauth' || s === 'needs-sign-in') return { word: 'NEEDS SIGN-IN', tone: 'wait', action: 'signin' }
  if (s === 'failed' || s === 'error') return { word: 'FAILED', tone: 'fail', action: 'retry' }
  if (s === 'pending' || s === 'connecting') return { word: 'PENDING', tone: 'idle', action: null }
  return { word: s ? s.toUpperCase() : 'UNKNOWN', tone: 'idle', action: null }
}
export const mcpNote = (rows: { status: string }[]): string => `${rows.filter((r) => r.status.toLowerCase() === 'connected').length} of ${rows.length} connected`

// ---- engine and hooks ----
export function versionNote(installed: string | null, latest: string | null): { text: string; update: string | null } {
  if (!installed) return { text: 'Not installed', update: null }
  if (!latest) return { text: installed, update: null }
  const n = (v: string) => v.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0)
  const a = n(installed)
  const b = n(latest)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0)
    if (d > 0) return { text: installed, update: latest }
    if (d < 0) break
  }
  return { text: installed, update: null }
}
export const hooksText = (h: { active: number; failing: number }): string => `${h.active} active, ${h.failing} failing`

// ---- thread rows: which threads need a fresh read ----
export const STALE_MS = 10_000
export const needsRead = (readAt: number | undefined, now: number): boolean => readAt === undefined || now - readAt >= STALE_MS
