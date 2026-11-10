// /status and /usage, answered by Hive itself, live (the engine's own are terminal-only): a card above the message box,
// refreshed every few seconds while it is open, from main's chat:statusView. Asking costs no usage.
import { useEffect, useState } from 'react'

type View = Awaited<ReturnType<Window['api']['chatStatusView']>>
const n = (x: number) => x.toLocaleString()
const k = (x: number) => (x >= 1000 ? `${Math.round(x / 100) / 10}k` : String(x))

function resetIn(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'resets now'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  return `resets in ${h ? `${h} h ` : ''}${m} min (${new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })})`
}

export function StatusCard({ kind, tabId, cwd, sessionId, onClose }: { kind: 'status' | 'usage'; tabId: string; cwd?: string; sessionId?: string; onClose: () => void }) {
  const [v, setV] = useState<View | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    const load = () => window.api.chatStatusView(tabId, { cwd, sessionId })
      .then((x) => { if (live) { setV(x); setErr('') } })
      .catch((e) => { if (live) setErr(String(e?.message ?? e)) })
    void load()
    const t = setInterval(load, 5000)
    return () => { live = false; clearInterval(t) }
  }, [tabId, cwd, sessionId])

  const rows: [string, string][] = !v ? [] : kind === 'status' ? [
    ['Account', `${v.account.email ?? 'unknown'}${v.account.organization ? ` (${v.account.organization})` : ''}`],
    ['Plan', v.account.plan ?? 'unknown'],
    ['Model', v.model ?? '(default)'],
    ['Effort', v.effort ?? '(default)'],
    ['Permission mode', v.permissionMode ?? (v.live ? 'unknown' : 'set when the thread starts')],
    ['Session', v.sessionId ?? 'none yet'],
    ['Folder', v.cwd ?? ''],
    ...(v.memoryDir ? [['Memory', v.memoryDir] as [string, string]] : []),
    ['Context', v.context ? (v.context.max ? `${k(v.context.total)} of ${k(v.context.max)} (${Math.round((100 * v.context.total) / v.context.max)}%)` : `${k(v.context.total)} (last request)`) : 'unknown'],
    ['Claude Code', v.engine.installed ? `installed${v.engine.version ? `, ${v.engine.version}` : ''}` : 'the SDK\'s bundled copy'],
    ['MCP servers', v.mcp.length ? v.mcp.map((s) => `${s.name}: ${s.status}${s.tools !== null ? ` (${s.tools} tools)` : ''}`).join(' · ') : 'none'],
  ] : [
    ['Plan', v.account.plan ?? 'unknown'],
    ...v.limits.map((l): [string, string] => [l.label, `${Math.round(l.pct)}% used${l.resetsAt ? `, ${resetIn(l.resetsAt)}` : ''}`]),
    ...(v.limits.length ? [] : [['Limits', 'no reading yet'] as [string, string]]),
    ['This thread', v.tokens ? `${n(v.tokens.requests)} requests: ${k(v.tokens.input)} input, ${k(v.tokens.output)} output, ${k(v.tokens.cacheRead)} cache read, ${k(v.tokens.cacheWrite)} cache written${v.tokens.complete ? '' : ' (still counting a long transcript)'}` : 'no transcript yet'],
    ['Context', v.context ? (v.context.max ? `${k(v.context.total)} of ${k(v.context.max)}` : `${k(v.context.total)} (last request)`) : 'unknown'],
    ...(v.limitsAt ? [['Read', new Date(v.limitsAt).toLocaleTimeString()] as [string, string]] : []),
  ]

  return (
    <div className="btw" data-testid={`status-card-${kind}`}>
      <div className="btw-q"><span className="btw-tag">{kind}</span>{kind === 'status' ? 'This thread, live' : 'Plan usage and this thread\'s tokens, live'}
        <button className="x" aria-label="Dismiss" onClick={onClose} data-testid="status-card-dismiss">×</button></div>
      <div className="btw-a">
        {err && <div className="derr">{err}</div>}
        {!v && !err && <div className="dnote">Reading…</div>}
        {rows.map(([a, b]) => <div key={a} className="drow"><span className="wlab">{a}</span><span>{b}</span></div>)}
        {v?.error && <div className="dnote">{v.error}</div>}
      </div>
    </div>
  )
}
