// Status strip under the top bar ("Gauges"): one column per item, small label on top,
// value in the middle, then a thin bar or a status word. Color only where something needs attention.
import { useEffect, useState, type ReactNode } from 'react'

const left = (iso: string | null, now: number) => {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}
const tone = (pct: number) => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok')
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
// claude-opus-5-5 -> Opus 5.5
const modelName = (id: string) => {
  const m = id.match(/claude-([a-z]+)-(\d+)-(\d+)/)
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id
}
const when = (t: number) => {
  const d = new Date(t)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

function Cell({ label, value, note, children }: { label: string; value: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="cell">
      <div className="l">{label}</div>
      <div className="v">{value}{note && <small>{note}</small>}</div>
      {children}
    </div>
  )
}
const Bar = ({ pct, t = '' }: { pct: number; t?: string }) => (
  <div className={`gbar ${t}`}><i style={{ width: `${Math.max(1, Math.min(100, pct))}%` }} /></div>
)
const Word = ({ t = '', children }: { t?: string; children: ReactNode }) => <div className={`w ${t}`}>{children}</div>

function LimitCell({ label, l, now }: { label: string; l: Limit; now: number }) {
  if (!l || l.pct === null) return null
  return (
    <Cell label={label} value={`${Math.round(l.pct)}%`} note={l.resetsAt && `resets ${left(l.resetsAt, now)}`}>
      <Bar pct={l.pct} t={tone(l.pct)} />
    </Cell>
  )
}

export function StatusBar({ sessionPath }: { sessionPath: string | null }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [now, setNow] = useState(Date.now())

  // account, limits and connectors: every minute
  useEffect(() => {
    const load = () => window.api.getStatus().then(setStatus).catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  // open session: on switch and every 10 s
  useEffect(() => {
    setStats(null)
    if (!sessionPath) return
    const load = () => window.api.sessionStats(sessionPath).then(setStats).catch(() => {})
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [sessionPath])

  // clock for the cache countdown and reset times
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const c = status?.connectors
  const cacheLeft = stats?.lastReplyAt ? stats.lastReplyAt + stats.cacheTtlMs - now : null
  // context window: 200k unless the session is already past it (1M models)
  const ctxMax = stats?.contextTokens && stats.contextTokens > 200_000 ? 1_000_000 : 200_000

  return (
    <div className="status">
      {!status && <Cell label="Status" value="Connecting…" />}
      {c && (
        <Cell label="MCP" value={`${c.connected}/${c.total}`} note={[c.needsAuth && `${c.needsAuth} sign-in`, c.failed && `${c.failed} failed`].filter(Boolean).join(', ')}>
          {c.failed ? <Word t="bad">{c.failed} FAILED</Word> : c.needsAuth ? <Word t="warn">{c.needsAuth} SIGN-IN</Word> : <Word t="ok">ALL CONNECTED</Word>}
        </Cell>
      )}
      {status?.account && (
        <Cell label="Account" value={status.account}>
          {status.plan && <Word>{status.plan.toUpperCase()} PLAN</Word>}
        </Cell>
      )}
      {status && <LimitCell label="5 hour" l={status.five} now={now} />}
      {status && <LimitCell label="7 day" l={status.seven} now={now} />}
      {stats?.contextTokens != null && (
        <Cell label="Context" value={k(stats.contextTokens)} note={`of ${k(ctxMax)}`}>
          <Bar pct={(stats.contextTokens / ctxMax) * 100} />
        </Cell>
      )}
      {cacheLeft != null && (
        <Cell label="Cache" value={cacheLeft > 0 ? mmss(cacheLeft) : '-'}>
          {cacheLeft > 0 ? <Word t="ok">WARM</Word> : <Word t="bad">COLD</Word>}
        </Cell>
      )}
      {stats && (
        <Cell label="Compactions" value={String(stats.compactions)}>
          <Word t={stats.compactions ? 'warn' : ''}>{stats.compactions ? 'CONTEXT SUMMARISED' : 'NONE YET'}</Word>
        </Cell>
      )}
      {stats?.model && (
        <Cell label="Model" value={modelName(stats.model)}>
          {stats.startedAt && <Word>STARTED {when(stats.startedAt).toUpperCase()}</Word>}
        </Cell>
      )}
      {status?.error && (
        <Cell label="Status" value="Error">
          <Word t="bad"><span title={status.error}>HOVER FOR REASON</span></Word>
        </Cell>
      )}
    </div>
  )
}
