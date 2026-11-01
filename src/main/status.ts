// Account, plan, usage limits and connector status, from one idle Claude Code process.
// The process is started with a prompt stream that never sends a message, so it costs no usage;
// it only answers the SDK's control questions.
import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import { claudeExecutable, engineInfo } from './engine'

export type Limit = { pct: number | null; resetsAt: string | null } | null
export type Status = {
  account: string | null
  plan: string | null
  five: Limit
  seven: Limit
  connectors: { connected: number; total: number; needsAuth: number; failed: number } | null
  engine: { installed: boolean; version: string | null }
  error?: string
}

let q: Query | null = null

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
export const idle = (): Query => (q ??= idleQuery())

const limit = (w: any): Limit => (w ? { pct: w.utilization ?? null, resetsAt: w.resets_at ?? null } : null)

export async function getStatus(): Promise<Status> {
  q ??= idleQuery()
  const [account, usage, mcp] = await Promise.allSettled([
    q.accountInfo(),
    q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
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
    five: limit(u?.rate_limits?.five_hour),
    seven: limit(u?.rate_limits?.seven_day),
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
  const pct = u?.rate_limits?.seven_day?.utilization
  weekly = typeof pct === 'number' && Number.isFinite(pct)
    ? { pct, readAt: Date.now(), error: '' }
    : { pct: null, readAt: Date.now(), error: err ? String((err as Error)?.message ?? err) : 'no 7-day limit in the usage answer' }
}
let reading: Promise<Weekly> | null = null
export function weeklyUsage(maxAgeMs = 5 * 60_000): Promise<Weekly> {
  if (weekly && Date.now() - weekly.readAt < maxAgeMs) return Promise.resolve(weekly)
  reading ??= (async () => {
    q ??= idleQuery()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('the usage read timed out')), 20_000) })
    try {
      remember(await Promise.race([q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), timeout]), null)
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
