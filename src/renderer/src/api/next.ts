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
async function call<T>(name: string, ...args: unknown[]): Promise<Avail<T>> {
  const seed = seeded(name) as { byArg?: Record<string, T>; fallback?: T } | T | undefined
  if (seed !== undefined) {
    const s = seed as { byArg?: Record<string, T>; fallback?: T }
    return { ok: true, data: (s && typeof s === 'object' && ('byArg' in s || 'fallback' in s) ? s.byArg?.[String(args[0])] ?? s.fallback : seed) as T }
  }
  const f = api()[name]
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
export type Wakeups = { wakeups: WakeRow[]; continues: ContinueRow[] }
export const wakeupsList = () => call<Wakeups>('wakeupsList')
export const wakeupsCancel = (kind: 'wake' | 'continue', id: string | number) => call<boolean>('wakeupsCancel', kind, id)
// expected: fire one now (a wake-up's prompt into its thread, or a continue at once)
export const wakeupsRunNow = (kind: 'wake' | 'continue', id: string | number) => call<boolean>('wakeupsRunNow', kind, id)
export const onWakeupsChanged = (cb: () => void) => listen('onWakeupsChanged', cb)

// ---- accounts: several signed-in accounts, switched at once (expected: accounts:list / accounts:use / ...) ----
export type Account = {
  id: string
  label: string // "Work", "Personal"
  email: string | null // or the API key's name
  plan: string | null // "Max 20x", "Pro", "Console, pay as you go"
  kind: 'subscription' | 'console'
  inUse: boolean
  limits?: UsageRow[] // 5-hour and weekly use, when the plan has them
  spend?: string | null // a console account's spend this month
  threads?: number // threads running on it now
}
export const accountsList = () => call<Account[]>('accountsList')
export const accountUse = (id: string) => call<boolean>('accountUse', id)
export const accountAdd = () => call<boolean>('accountAdd')
export const threadAccount = (tabId: string, accountId: string) => call<boolean>('threadSetAccount', tabId, accountId)
export const onAccountsChanged = (cb: () => void) => listen('onAccountsChanged', cb)

// ---- quiet hours: no desktop or phone ring between two times, except failures and deploys ----
export type QuietHours = { on: boolean; from: string; to: string; ringFailures: boolean; ringDeploys: boolean }
export const quietHoursGet = () => call<QuietHours>('quietHoursGet')
export const quietHoursSet = (q: QuietHours) => call<boolean>('quietHoursSet', q)

// ---- stop everything: every turn interrupted, every task stopped, every queue held; wake-ups stay ----
export const stopEverythingMain = () => call<{ threads: number; tasks: number }>('stopEverything')


// ---- the engine's slash commands for the composer and the palette (exists: chat:commands) ----
export type EngineCommand = { name: string; description: string; argumentHint?: string }
export const engineCommands = (tabId?: string) => call<EngineCommand[]>('chatCommands', tabId)
