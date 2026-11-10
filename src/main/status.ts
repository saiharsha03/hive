// Account, plan, usage limits and connector status, from one idle Claude Code process.
// The process is started with a prompt stream that never sends a message, so it costs no usage;
// it only answers the SDK's control questions.
import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import { claudeExecutable, engineInfo } from './engine'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterReset, realLimits, usageRows, type UsageRow } from '../shared/usageCore'
import { readUsageFile, writeUsageFile } from './usageFile'

export type Limit = { pct: number | null; resetsAt: string | null } | null
export type Status = {
  account: string | null
  plan: string | null
  five: Limit
  seven: Limit
  usage: UsageRow[] // every plan window with a reading, for the usage popover and the phone
  usageAt: number | null // when that reading was taken
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
  if (q && stamp !== startedOn) { q.close(); q = null; usage = null; lastIdleTry = 0 }
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

const limit = (w: any): Limit => (w ? afterReset({ pct: w.utilization ?? null, resetsAt: w.resets_at ?? null }) : null)

// Plan limits. Only a process that has talked to the API carries them: a live thread answers from its last reply's
// headers in a few ms (the same numbers the terminal's status line gets), so it is read on every poll. Only when no
// thread has them is the idle process asked, which goes to the rate-limited usage endpoint and sometimes answers with
// a placeholder: that read is tried at most once per IDLE_MS. Only a real answer replaces the reading, which keeps its
// time so the bar can say how old it is.
let liveUsage: () => Promise<{ u: any; at: number } | null> = async () => null
export const setLiveUsage = (f: () => Promise<{ u: any; at: number } | null>) => { liveUsage = f }
const IDLE_MS = 5 * 60_000
const FRESH_MS = 10 * 60_000 // a live sample older than this (its reply's time) also asks the endpoint
let usage: { limits: any; plan: string | null; at: number } | null = null
let usageFromFile = false // the reading came from the shared usage file, not from this app: read the file again each time
let lastIdleTry = 0
let trying: Promise<void> | null = null
const within = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))])
const keep = (u: any, at: number): boolean => {
  if (!realLimits(u?.rate_limits) || (usage && at < usage.at)) return false
  usage = { limits: u.rate_limits, plan: u.subscription_type ?? null, at }
  usageFromFile = false
  writeUsageFile(u.rate_limits) // for a usage-guard hook (usageFile.ts): at most once a minute, never in test mode
  return true
}
function readUsage(force = false): Promise<void> {
  trying ??= (async () => {
    const live = await within(liveUsage(), 10_000)
    if (live && keep(live.u, live.at) && Date.now() - live.at < FRESH_MS) return
    if (!force && Date.now() - lastIdleTry < IDLE_MS) return
    lastIdleTry = Date.now()
    keep(await within(current().usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), 20_000), Date.now())
  })().finally(() => { trying = null })
  return trying
}

// force: ask the usage endpoint now (what /usage reads), without waiting out the five minutes between quiet tries
export async function getStatus(force = false): Promise<Status> {
  const q = current()
  const [account, mcp] = await Promise.allSettled([q.accountInfo(), q.mcpServerStatus(), readUsage(force)])
  const a = account.status === 'fulfilled' ? account.value : null
  const m = mcp.status === 'fulfilled' ? mcp.value : null
  const failed = [account, mcp].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
  // no reading of this app's own (the usage endpoint answers nothing until a thread here has had a reply): take the
  // newest one another Claude session wrote to the usage file, at most an hour old
  if (!usage || usageFromFile) {
    const shared = readUsageFile(60 * 60_000)
    if (shared) { usage = { limits: shared.limits, plan: null, at: shared.at }; usageFromFile = true }
  }
  const l = usage?.limits
  return {
    account: a?.email ?? null,
    plan: usage?.plan ?? a?.subscriptionType ?? null,
    five: limit(l?.five_hour),
    seven: limit(l?.seven_day),
    usage: usageRows(l),
    usageAt: usage?.at ?? null,
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

// the 7-day limit for watchers' adaptive schedules: the latest reading, read again when it is older than maxAgeMs
export type Weekly = { pct: number | null; readAt: number; error: string }
export async function weeklyUsage(maxAgeMs = IDLE_MS): Promise<Weekly> {
  if (!usage || Date.now() - usage.at > maxAgeMs) await readUsage(true)
  const pct = limit(usage?.limits?.seven_day)?.pct
  return typeof pct === 'number' && Number.isFinite(pct)
    ? { pct, readAt: usage!.at, error: '' }
    : { pct: null, readAt: Date.now(), error: 'no 7-day limit in the usage answer' }
}

// after an account switch: does the login now in the files answer? A rejected usage read that talks about the login
// or a token means it no longer works (sign in with the browser again); a slow or other answer is taken as fine
export async function checkLogin(): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.race([
      current().usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      new Promise((r) => setTimeout(r, 20_000)),
    ])
    return { ok: true }
  } catch (e) {
    const m = String((e as Error)?.message ?? e)
    return /auth|login|token|401|403|expired|credential|unauthori/i.test(m) ? { ok: false, error: m.slice(0, 300) } : { ok: true }
  }
}

export function closeStatus(): void {
  q?.close()
  q = null
}

// signed in to another account: the next question starts a fresh idle process on the new login, and the old login's
// usage reading is dropped (the credentials-file check does the same when the login changes outside Hive)
export function restartStatus(): void {
  closeStatus()
  usage = null
  lastIdleTry = 0
}
