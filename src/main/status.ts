// Account, plan, usage limits and connector status, from one idle Claude Code process.
// The process is started with a prompt stream that never sends a message, so it costs no usage;
// it only answers the SDK's control questions.
import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import { claudeExecutable, engineInfo } from './engine'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { realLimits, usageRows, type UsageRow } from '../shared/usageCore'

export type Limit = { pct: number | null; resetsAt: string | null } | null
export type Status = {
  account: string | null
  plan: string | null
  five: Limit
  seven: Limit
  usage: UsageRow[] // every plan window with a reading, for the usage popover and the phone
  connectors: { connected: number; total: number; needsAuth: number; failed: number } | null
  engine: { installed: boolean; version: string | null }
  error?: string
}

let q: Query | null = null
// the login the idle process started with: signing in again (claude /login in a terminal, another account) rewrites
// the credentials file, and the process keeps answering for the old account until it is started again
const credentials = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json')
const loginStamp = () => { try { return statSync(credentials()).mtimeMs } catch { return 0 } }
let startedOn = 0
function current(): Query {
  const stamp = loginStamp()
  if (q && stamp !== startedOn) { q.close(); q = null; lastGood = null; usageCache = null }
  if (!q) { q = idleQuery(); startedOn = stamp }
  return q
}

function idleQuery(): Query {
  const never: AsyncIterable<any> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }
  // user + project + local settings, so MCP servers load exactly as in the terminal
  const idleQ = query({ prompt: never, options: { settingSources: ['user', 'project', 'local'], pathToClaudeCodeExecutable: claudeExecutable() } })
  // drain its messages (hook and plugin system events): unread, the SDK queues them forever (268k / 40 MB in a day)
  void (async () => { for await (const _ of idleQ) { /* nothing to show */ } })()
    .catch(() => {})
    .finally(() => { if (q === idleQ) q = null })
  return idleQ
}

// the idle process, for lists a tab without its own running process asks for (commands, models, MCP servers)
export const idle = (): Query => current()

// a placeholder answer never replaces a real reading (usageCore)
const limit = (w: any): Limit => (w ? { pct: w.utilization ?? null, resetsAt: w.resets_at ?? null } : null)

// Rate limits come only from a process that has talked to the API, so the idle one answers without them. A live
// thread's usage answer stands in (the app sets this to the chat's reader); the last good limits are kept for a while
// so the bar does not go blank between runs.
let liveUsage: () => Promise<any | null> = async () => null
export const setLiveUsage = (f: () => Promise<any | null>) => { liveUsage = f }
const KEEP_MS = 6 * 3_600_000
let lastGood: { limits: any; at: number } | null = null
// a live thread's limits first, then the idle process's, then the last real reading
async function withLimits(u: any): Promise<any> {
  const live = (await liveUsage().catch(() => null))?.rate_limits
  const limits = [live, u?.rate_limits].find(realLimits)
  if (limits) { lastGood = { limits, at: Date.now() }; return { ...u, rate_limits: limits } }
  return lastGood && Date.now() - lastGood.at < KEEP_MS ? { ...u, rate_limits: lastGood.limits } : u
}
// the usage endpoint is rate limited: one answer serves the minute polls for USAGE_MS
const USAGE_MS = 5 * 60_000
const PLACEHOLDER_MS = 2 * 60_000
let usageCache: { at: number; u: any } | null = null
async function usageNow(q: Query): Promise<any> {
  if (usageCache && Date.now() - usageCache.at < USAGE_MS) return usageCache.u
  const u = await withLimits(await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }))
  // only a real reading is kept: right after a start no thread has talked to the API yet, and caching that
  // placeholder held the bar at 0% for the whole window
  // a placeholder is kept briefly too (the endpoint is rate limited), then a real reading is tried again
  usageCache = { at: realLimits(u?.rate_limits) ? Date.now() : Date.now() - USAGE_MS + PLACEHOLDER_MS, u }
  return u
}

export async function getStatus(): Promise<Status> {
  const q = current()
  const [account, usage, mcp] = await Promise.allSettled([
    q.accountInfo(),
    usageNow(q),
    q.mcpServerStatus(),
  ])
  const a = account.status === 'fulfilled' ? account.value : null
  const u = usage.status === 'fulfilled' ? usage.value : null
  const m = mcp.status === 'fulfilled' ? mcp.value : null
  const failed = [account, usage, mcp].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
  remember(u, usage.status === 'rejected' ? usage.reason : null)
  return {
    account: a?.email ?? null,
    plan: u?.subscription_type ?? a?.subscriptionType ?? null,
    // a placeholder is no reading: the meters stay hidden until a real one arrives (not a fake 0%)
    five: realLimits(u?.rate_limits) ? limit(u?.rate_limits?.five_hour) : null,
    seven: realLimits(u?.rate_limits) ? limit(u?.rate_limits?.seven_day) : null,
    usage: usageRows(u?.rate_limits),
    connectors: m && {
      connected: m.filter((s) => s.status === 'connected').length,
      total: m.length,
      needsAuth: m.filter((s) => s.status === 'needs-auth').length,
      failed: m.filter((s) => s.status === 'failed').length,
    },
    engine: await engineInfo(),
    error: failed ? String(failed.reason?.message ?? failed.reason) : undefined,
  }
}

// the 7-day limit for Watch's adaptive sweeps: the latest reading from the status bar's poll (every minute while the
// window is open) or from its own call when that reading is older than maxAgeMs
export type Weekly = { pct: number | null; readAt: number; error: string }
let weekly: Weekly | null = null
function remember(u: any, err: unknown) {
  // a placeholder answer never overwrites a real reading (its 7-day number is stale)
  if (!err && !realLimits(u?.rate_limits) && weekly?.pct != null) { weekly = { ...weekly, readAt: Date.now() }; return }
  const pct = realLimits(u?.rate_limits) ? u?.rate_limits?.seven_day?.utilization : undefined
  weekly = typeof pct === 'number' && Number.isFinite(pct)
    ? { pct, readAt: Date.now(), error: '' }
    : { pct: null, readAt: Date.now(), error: err ? String((err as Error)?.message ?? err) : 'no 7-day limit in the usage answer' }
}
let reading: Promise<Weekly> | null = null
export function weeklyUsage(maxAgeMs = 5 * 60_000): Promise<Weekly> {
  if (weekly && Date.now() - weekly.readAt < maxAgeMs) return Promise.resolve(weekly)
  reading ??= (async () => {
    const q = current()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('the usage read timed out')), 20_000) })
    try {
      remember(await Promise.race([q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }).then(withLimits), timeout]), null)
    } catch (e) {
      remember(null, e)
    } finally {
      clearTimeout(timer)
      reading = null
    }
    return weekly!
  })()
  return reading
}

export function closeStatus(): void {
  q?.close()
  q = null
}
