// What the terminal's /status and /usage show, for one thread, live: account and plan, model, effort, permission mode,
// session, folder, context use, MCP servers, plan limits with their reset times and the thread's own token totals from
// its transcript. Everything comes from what Hive already has: the thread's live process (or the idle status process),
// status.ts's usage reading and sessionStats.ts's incremental totals. Nothing here sends a message, so it costs no usage.
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { getStatus, idle } from './status'
import { sessionStats, sessionTotals, type SessionTotals } from './sessionStats'
import type { UsageRow } from '../shared/usageCore'

export type ThreadStatusView = {
  live: boolean // the thread has a running Claude process (else the answers come from the idle status process)
  account: { email: string | null; organization: string | null; plan: string | null; tokenSource: string | null; apiProvider: string | null }
  engine: { installed: boolean; version: string | null }
  model: string | null
  effort: string | null
  permissionMode: string | null
  sessionId: string | null
  cwd: string | null
  transcript: string | null
  memoryDir: string | null // the shared auto-memory folder the thread was given, if any
  context: { total: number; max: number } | null // the live process's own count; else the last request's from the transcript
  cache: { lastReplyAt: number | null; ttlMs: number } | null
  compactions: number
  mcp: { name: string; status: string; source: string; error?: string; tools: number | null }[]
  limits: UsageRow[] // every plan window with its use (0-100) and reset time
  limitsAt: number | null // when that reading was taken
  tokens: SessionTotals | null // this thread's requests, summed from its transcript
  error?: string
}

export type Facts = { sessionId: string | null; cwd: string; mode: string | null; model: string | null; effort: string | null; memoryDir: string | null }
type Deps = {
  liveQuery: (tabId: string) => Query | undefined
  facts: (tabId: string) => Facts | null
  transcript: (cwd: string, sessionId: string) => string
  status?: typeof getStatus // tests: stand-ins for status.ts
  idle?: () => Pick<Query, 'accountInfo' | 'mcpServerStatus'>
}

const within = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))])

// a tab with no process yet still knows its folder and session (the window passes them)
export async function threadStatusView(deps: Deps, tabId: string, known: { cwd?: string; sessionId?: string } = {}): Promise<ThreadStatusView> {
  const q = deps.liveQuery(tabId)
  const f = deps.facts(tabId)
  const cwd = f?.cwd ?? known.cwd ?? null
  const sessionId = f?.sessionId ?? known.sessionId ?? null
  const transcript = cwd && sessionId ? deps.transcript(cwd, sessionId) : null
  const ask = q ?? (deps.idle ?? idle)()
  const [st, account, mcp, ctx, stats, tokens] = await Promise.all([
    within((deps.status ?? getStatus)(), 15_000),
    within(ask.accountInfo(), 10_000),
    within(ask.mcpServerStatus(), 10_000),
    q ? within(q.getContextUsage({ detail: 'summary' }), 10_000) : Promise.resolve(null),
    transcript ? sessionStats(transcript).catch(() => null) : Promise.resolve(null),
    transcript ? sessionTotals(transcript).catch(() => null) : Promise.resolve(null),
  ])
  return {
    live: !!q,
    account: {
      email: account?.email ?? st?.account ?? null, organization: account?.organization ?? null,
      plan: st?.plan ?? account?.subscriptionType ?? null, tokenSource: account?.tokenSource ?? null, apiProvider: account?.apiProvider ?? null,
    },
    engine: st?.engine ?? { installed: false, version: null },
    model: f?.model ?? stats?.model ?? null,
    effort: f?.effort ?? null,
    permissionMode: f?.mode ?? null,
    sessionId, cwd, transcript,
    memoryDir: f?.memoryDir ?? null,
    context: ctx ? { total: ctx.totalTokens, max: ctx.maxTokens } : stats?.contextTokens != null ? { total: stats.contextTokens, max: 0 } : null,
    cache: stats ? { lastReplyAt: stats.lastReplyAt, ttlMs: stats.cacheTtlMs } : null,
    compactions: stats?.compactions ?? 0,
    mcp: (mcp ?? []).map((s) => ({ name: s.name, status: s.status, source: s.source ?? s.scope ?? '', error: s.error, tools: s.tools?.length ?? null })),
    limits: st?.usage ?? [],
    limitsAt: st?.usageAt ?? null,
    tokens,
    ...(st?.error ? { error: st.error } : {}),
  }
}
