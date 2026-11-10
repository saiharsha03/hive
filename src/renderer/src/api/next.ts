import { useEffect, useState } from 'react'

// The main-process calls the new UI needs that are still landing (accounts, live status and usage, the wake-up list,
// quiet hours, stop everything). Each one feature-detects window.api.<method> and answers { ok: false, reason } when
// main does not have it yet, so every page draws before and after the main-process work lands. When a method lands
// with the shape below, nothing here changes; when it lands with another shape, only this file does.

export type Avail<T> = { ok: true; data: T } | { ok: false; reason: string }
export const NOT_YET = 'Not available yet: this needs the main-process update'

const api = (): Record<string, unknown> => (window as unknown as { api?: Record<string, unknown> }).api ?? {}
// In test mode only, the screenshot script may seed answers for calls main does not have yet: window.__hiveSeed[name]
// (an object with byArg answers by the first argument, with fallback for the rest)
const seeded = (name: string): unknown => (window.api?.testMode ? (window as unknown as { __hiveSeed?: Record<string, unknown> }).__hiveSeed?.[name] : undefined)
export const hasApi = (name: string): boolean => typeof api()[name] === 'function' || seeded(name) !== undefined
// `name` is the seed key (what scripts/ui-shots.mjs seeds); `real` is the preload method when it is named differently
async function call<T>(name: string, ...args: unknown[]): Promise<Avail<T>> { return callAs<T>(name, name, ...args) }
async function callAs<T>(name: string, real: string, ...args: unknown[]): Promise<Avail<T>> {
  const seed = seeded(name) as { byArg?: Record<string, T>; fallback?: T } | T | undefined
  if (seed !== undefined) {
    const s = seed as { byArg?: Record<string, T>; fallback?: T }
    return { ok: true, data: (s && typeof s === 'object' && ('byArg' in s || 'fallback' in s) ? s.byArg?.[String(args[0])] ?? s.fallback : seed) as T }
  }
  const f = api()[real]
  if (typeof f !== 'function') return { ok: false, reason: NOT_YET }
  try {
    return { ok: true, data: (await (f as (...a: unknown[]) => Promise<T>)(...args)) }
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
  }
}
function listen(name: string, cb: (...a: any[]) => void): () => void {
  const f = api()[name]
  return typeof f === 'function' ? (f as (c: typeof cb) => () => void)(cb) : () => {}
}

// ---- live status: what /status and /usage show for one thread (main: chat:statusView) ----
export type UsageRow = { key: string; label: string; pct: number; resetsAt: string | null }
export type SessionTotals = { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number; complete: boolean }
export type ThreadStatusView = {
  live: boolean
  account: { email: string | null; organization: string | null; plan: string | null; tokenSource: string | null; apiProvider: string | null }
  engine: { installed: boolean; version: string | null }
  model: string | null
  effort: string | null
  permissionMode: string | null
  sessionId: string | null
  cwd: string | null
  transcript: string | null
  memoryDir: string | null
  context: { total: number; max: number } | null
  cache: { lastReplyAt: number | null; ttlMs: number } | null
  compactions: number
  mcp: { name: string; status: string; source: string; error?: string; tools: number | null }[]
  limits: UsageRow[]
  limitsAt: number | null
  tokens: SessionTotals | null
  // expected later, shown when present: output style, memory files, hooks, context parts and the auto-compact point
  outputStyle?: string | null
  memoryFiles?: string[]
  hooks?: { active: number; failing: number }
  contextParts?: { system: number; tools: number; memory: number; messages: number }
  autoCompactAt?: number | null
  error?: string
}
export const statusView = (tabId: string, known?: { cwd?: string; sessionId?: string }) => call<ThreadStatusView>('chatStatusView', tabId, known)

// ---- wake-ups and automatic continues (main: wakeups:list / wakeups:cancel / wakeups:changed) ----
export type WakeRow = { id: number; sessionId: string; title: string; wakeAt: string; prompt: string; everyMinutes: number | null; firedAt: string | null }
export type ContinueRow = { key: string; tabId: string; title: string; at: number }
export type Wakeups = { wakeups: WakeRow[]; continues: ContinueRow[]; paused?: boolean; held?: number }
export const wakeupsList = () => call<Wakeups>('wakeupsList')
export const wakeupsCancel = (kind: 'wake' | 'continue', id: string | number) => call<boolean>('wakeupsCancel', kind, id)
// fire one now (a wake-up's prompt into its thread, or a continue at once)
export const wakeupsRunNow = (kind: 'wake' | 'continue', id: string | number) => call<boolean>('wakeupsRunNow', kind, id)
export const onWakeupsChanged = (cb: () => void) => listen('onWakeupsChanged', cb)

// ---- accounts: the saved logins, switched without a restart (main: accounts:list / accounts:switch / accounts:remove) ----
export type Account = {
  id: string
  label: string // the name before the @, or the seed's "Work"
  email: string | null
  plan: string | null // "Max 20x", "Pro"
  organization?: string | null
  kind: 'subscription' | 'console'
  inUse: boolean
  limits?: UsageRow[] // 5-hour and weekly use, when known
  spend?: string | null
  threads?: number
}
type SavedAccount = { id: string; email: string; organization: string | null; plan: string | null; active: boolean }
const toAccount = (a: Account | SavedAccount): Account =>
  'inUse' in a ? a : { id: a.id, label: a.email.split('@')[0] || a.email, email: a.email, plan: a.plan, organization: a.organization, kind: 'subscription', inUse: a.active }
export const accountsList = async (): Promise<Avail<Account[]>> => {
  const r = await call<(Account | SavedAccount)[]>('accountsList')
  return r.ok ? { ok: true, data: r.data.map(toAccount) } : r
}
export type SwitchResult = { ok: boolean; account: string | null; closed: number; waiting: number; warning?: string; needsSignIn?: boolean; error?: string }
export const accountsSwitch = (id: string) => callAs<SwitchResult>('accountsSwitch', 'accountsSwitch', id)
// the old adapter name: true when the switch finished
export const accountUse = async (id: string): Promise<Avail<boolean>> => {
  const r = await accountsSwitch(id)
  if (!r.ok) return r
  return r.data.ok ? { ok: true, data: true } : { ok: false, reason: r.data.error ?? 'The switch did not finish.' }
}
export const accountsRemove = (id: string) => call<boolean>('accountsRemove', id)
export const onAccountsChanged = (cb: () => void) => listen('onAccountsChanged', cb)
export const onAccountSwitched = (cb: (s: { account: string | null; closed: number; waiting: number }) => void) => listen('onAccountSwitched', cb)

// ---- quiet hours: no desktop or phone ring between two times; a failure still rings (main: quiet:get / quiet:set) ----
export type QuietHours = { on: boolean; from: string; to: string }
export const quietHoursGet = () => callAs<QuietHours>('quietHoursGet', 'quietGet')
const quietListeners = new Set<(q: QuietHours) => void>()
export const quietHoursSet = async (q: QuietHours): Promise<Avail<QuietHours>> => {
  const r = await callAs<QuietHours>('quietHoursSet', 'quietSet', { on: q.on, from: q.from, to: q.to })
  if (r.ok) { const now = r.data && typeof r.data === 'object' ? r.data : q; for (const f of quietListeners) f(now) }
  return r
}
// for the status line: null until read; refreshed after Settings saves
export function useQuietHours(): QuietHours | null {
  const [q, setQ] = useState<QuietHours | null>(null)
  useEffect(() => {
    let live = true
    void quietHoursGet().then((r) => { if (live && r.ok && r.data) setQ({ on: !!r.data.on, from: r.data.from, to: r.data.to }) })
    const f = (n: QuietHours) => setQ({ on: !!n.on, from: n.from, to: n.to })
    quietListeners.add(f)
    return () => { live = false; quietListeners.delete(f) }
  }, [])
  return q
}

// ---- stop everything: every turn interrupted, every task stopped, every queue held (main: hive:stopAll / hive:resumeAll) ----
export const stopEverythingMain = (pause?: boolean) => callAs<{ threads: number; tasks: number }>('stopEverything', 'stopAll', !!pause)
export const resumeEverything = () => callAs<{ queues: number; wakeups: boolean }>('resumeAll', 'resumeAll')
export const wakeupsPause = (on: boolean) => call<boolean>('wakeupsPause', on)


// ---- the engine's slash commands for the composer and the palette (exists: chat:commands) ----
export type EngineCommand = { name: string; description: string; argumentHint?: string }
export const engineCommands = (tabId?: string) => call<EngineCommand[]>('chatCommands', tabId)
