// Account, plan, usage limits and connector status, from one idle Claude Code process.
// The process is started with a prompt stream that never sends a message, so it costs no usage;
// it only answers the SDK's control questions.
import { query, type Query } from '@anthropic-ai/claude-agent-sdk'

export type Limit = { pct: number | null; resetsAt: string | null } | null
export type Status = {
  account: string | null
  plan: string | null
  five: Limit
  seven: Limit
  connectors: { connected: number; total: number; needsAuth: number; failed: number } | null
  error?: string
}

let q: Query | null = null

function idleQuery(): Query {
  const never: AsyncIterable<any> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }
  // user + project + local settings, so MCP servers load exactly as in the terminal
  return query({ prompt: never, options: { settingSources: ['user', 'project', 'local'] } })
}

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
    error: failed ? String(failed.reason?.message ?? failed.reason) : undefined,
  }
}

export function closeStatus(): void {
  q?.close()
  q = null
}
