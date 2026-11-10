// Status and usage: what /status and /usage show, live, for the focused thread and for every open thread.
// Reads main through the adapter (api/next.ts); where a call is not there yet it falls back to getStatus() and
// chatMcp(), so the page is useful before the main-process update lands.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bar, Btn, Empty, KV, PageHead, Section, State, Unavailable, WARN_PCT, tokens } from '../kit'
import { statusView, type Avail, type ThreadStatusView, type UsageRow } from '../api/next'
import { usePanes, useSessionMetas, type SessionMeta } from '../store'
import { focusedTab } from '../panes'
import { notice } from '../actions'
import { useThreadStatus } from '../statusStore'
import { modelLabel } from '../../../shared/statusCore'
import {
  addReading, compactTick, contextSegments, contextShort, forecast, forecastText, forecastWarns, grouped, hooksText,
  mcpNote, mcpState, needsRead, resetMs, resetText, sinceText, versionNote, windowOf, type Reading,
} from './statusCore'
import './status.css'

type Fallback = Awaited<ReturnType<typeof window.api.getStatus>>
type Slot = { at: number; res: Avail<ThreadStatusView>; ctx: { total: number; max: number } | null }

// readings of each limit over time, kept in memory for the forecast (they outlive a visit to another page)
const readings = new Map<string, Reading[]>()

function useTick(ms: number): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return n
}
function useVisible(): boolean {
  const [v, setV] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const f = () => setV(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  return v
}

const isThread = (m: SessionMeta) => !m.id.startsWith('tool:') && !m.id.startsWith('script:') && !m.id.startsWith('file:')

export function StatusPage() {
  const metas = useSessionMetas()
  const pane = usePanes()
  const focused = focusedTab(pane)
  const threads = useMemo(() => metas.filter(isThread), [metas])
  const focusMeta = threads.find((m) => m.id === focused) ?? threads[0]
  const visible = useVisible()
  const now = useTick(1000)

  const [slots, setSlots] = useState<Record<string, Slot>>({})
  const [base, setBase] = useState<Fallback | null>(null)
  const [mcp, setMcp] = useState<McpServerRow[] | null>(null)
  const [hooks, setHooks] = useState<{ active: number; failing: number } | null>(null)
  const [latest, setLatest] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [, bump] = useState(0)
  const slotAt = useRef<Record<string, number>>({})
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const focusRef = useRef(focusMeta?.id)
  focusRef.current = focusMeta?.id

  const readOne = useCallback(async (m: SessionMeta) => {
    const [res, ctx] = await Promise.all([
      statusView(m.id, { cwd: m.cwd, sessionId: m.sessionId }),
      window.api.chatContext(m.id).catch(() => null),
    ])
    setSlots((s) => ({ ...s, [m.id]: { at: Date.now(), res, ctx } }))
    setLastAt(Date.now())
  }, [])

  // the focused thread every 5 s, the others at most every 10 s, only while the page is visible
  useEffect(() => {
    if (!visible) return
    const run = () => {
      const t = Date.now()
      for (const m of threadsRef.current) {
        const isFocus = m.id === focusRef.current
        const at = slotAt.current[m.id]
        if (isFocus ? at === undefined || t - at >= 5000 : needsRead(at, t)) { slotAt.current[m.id] = t; void readOne(m) }
      }
      void window.api.getStatus().then((b) => { setBase(b); setLastAt(Date.now()) }).catch(() => {})
      if (focusRef.current) void window.api.chatMcp(focusRef.current).then(setMcp).catch(() => setMcp(null))
    }
    run()
    const id = setInterval(run, 5000)
    return () => clearInterval(id)
  }, [visible, readOne, focusMeta?.id])

  useEffect(() => { void window.api.engineLatest().then(setLatest).catch(() => {}) }, [])
  const cwd = focusMeta?.cwd
  useEffect(() => {
    setHooks(null)
    if (!cwd) return
    void window.api.listHooks(cwd).then((rows) => setHooks({ active: rows.filter((r) => r.enabled).length, failing: 0 })).catch(() => {})
  }, [cwd])

  const slot = focusMeta ? slots[focusMeta.id] : undefined
  const view = slot?.res.ok ? slot.res.data : null
  const viewWhy = slot && !slot.res.ok ? slot.res.reason : null

  // ---- limits: the thread's own, else the app's ----
  const limits: UsageRow[] = useMemo(() => {
    if (view?.limits.length) return view.limits
    if (base?.usage?.length) return base.usage
    const rows: UsageRow[] = []
    if (base?.five?.pct != null) rows.push({ key: 'five_hour', label: '5-hour', pct: base.five.pct, resetsAt: base.five.resetsAt })
    if (base?.seven?.pct != null) rows.push({ key: 'seven_day', label: '7-day', pct: base.seven.pct, resetsAt: base.seven.resetsAt })
    return rows
  }, [view, base])
  const limitsAt = view?.limitsAt ?? base?.usageAt ?? lastAt
  useEffect(() => {
    for (const l of limits) readings.set(l.key, addReading(readings.get(l.key) ?? [], limitsAt ?? Date.now(), l.pct))
    bump((n) => n + 1)
  }, [limits, limitsAt])

  const account = view?.account.email ?? base?.account ?? null
  const plan = view?.account.plan ?? base?.plan ?? null
  const engineVersion = view?.engine.version ?? base?.engine.version ?? null
  const ver = versionNote(engineVersion, latest)
  const tstat = useThreadStatus(focusMeta?.id)
  const model = view?.model ?? tstat.model ?? null
  const effort = view?.effort ?? tstat.effort ?? null
  const mcpRows = view?.mcp.length ? view.mcp : (mcp ?? [])
  const chrome = mcpRows.find((r) => /chrome/i.test(r.name))
  const ctx = view?.context ?? slot?.ctx ?? null
  const hookInfo = view?.hooks ?? hooks

  const update = async () => {
    setUpdating(true)
    const r = await window.api.engineUpdate().catch(() => ({ ok: false, output: 'Update failed' }))
    setUpdating(false)
    notice(r.ok ? 'Claude Code updated' : `Update failed: ${r.output.split('\n').filter(Boolean).at(-1) ?? ''}`)
    void window.api.getStatus().then(setBase).catch(() => {})
  }

  const rows: [string, ReactNode][] = []
  rows.push(['Account', account ?? 'Not signed in'])
  rows.push(['Plan', plan ?? ''])
  rows.push(['Claude Code', (
    <span className="stp-ver">
      {ver.text}{ver.update ? '' : latest && engineVersion ? ' (latest)' : ''}
      {ver.update && <> <span className="stp-dim">update to {ver.update}</span> <Btn kind="plain" onClick={() => void update()} disabled={updating} testid="status-update">{updating ? 'Updating' : 'Update'}</Btn></>}
    </span>
  )])
  if (model) rows.push(['Model', <span key="m">{modelLabel(model)} <span className="stp-mono stp-dim">{model}</span></span>])
  if (effort) rows.push(['Effort', effort])
  if (view?.permissionMode) rows.push(['Permission mode', view.permissionMode])
  if (view?.outputStyle) rows.push(['Output style', view.outputStyle])
  if (view?.cwd ?? focusMeta?.cwd) rows.push(['Working folder', <span key="c" className="stp-mono">{view?.cwd ?? focusMeta?.cwd}</span>])
  if (view?.memoryDir) rows.push(['Memory', <span key="d"><span className="stp-mono">{view.memoryDir}</span>{view.memoryFiles ? ` (${view.memoryFiles.length} files)` : ''}</span>])
  if (hookInfo) rows.push(['Hooks', hooksText(hookInfo)])
  if (chrome) {
    const st = mcpState(chrome.status)
    rows.push(['Claude in Chrome', <State key="ch" word={st.word} tone={st.tone} />])
  }

  const segs = ctx ? contextSegments(ctx, view?.contextParts) : []
  const tick = ctx ? compactTick(view?.autoCompactAt, ctx.max) : null
  const planNote = [account, plan].filter(Boolean).join(', ')

  return (
    <div className="page stp" data-testid="page-status">
      <PageHead title="Status and usage" desc={sinceText(lastAt, now)} right="/status and /usage open here" />
      <div className="grid2">
        <div>
          <Section title="Status" note={focusMeta ? `Focused thread: ${focusMeta.title}` : 'No thread open'} testid="status-main">
            <KV rows={rows} testid="status-kv" />
            {viewWhy && <Unavailable reason={`Permission mode, working folder, output style and memory: ${viewWhy}`} />}
          </Section>

          <Section title="Context" note={ctx ? `${grouped(ctx.total)} of ${grouped(ctx.max)}` : undefined} testid="status-context">
            {!ctx ? (focusMeta ? <Unavailable reason={viewWhy ?? 'No context reading for this thread yet'} /> : <Empty>Open a thread to see its context.</Empty>) : (
              <div className="stp-ctx">
                <div className="stp-ctxbar" role="img" aria-label={`Context ${contextShort(ctx.total, ctx.max)}`}>
                  {segs.map((s) => <span key={s.key} className={`stp-seg stp-seg-${s.key}`} style={{ width: `${s.pct}%` }} />)}
                  {tick !== null && <span className="stp-tick" style={{ left: `${tick}%` }} title="Auto-compact" />}
                </div>
                <div className="stp-legend">
                  {segs.map((s) => <span key={s.key}><i className={`stp-key stp-seg-${s.key}`} />{s.label}</span>)}
                  {tick !== null && <span><i className="stp-key stp-key-tick" />Auto-compact at {contextShort(view?.autoCompactAt ?? 0, ctx.max).split(' / ')[0]}</span>}
                </div>
                {view && view.compactions > 0 && <div className="stp-dim stp-small">Compacted {view.compactions} time{view.compactions === 1 ? '' : 's'}</div>}
              </div>
            )}
          </Section>

          <Section title="MCP servers" note={mcpRows.length ? mcpNote(mcpRows) : undefined} testid="status-mcp">
            {mcpRows.length === 0 ? <Empty>{focusMeta ? 'No MCP servers in this thread.' : 'Open a thread to see its MCP servers.'}</Empty> : (
              <div className="stp-mcp">
                {mcpRows.map((r) => {
                  const st = mcpState(r.status)
                  return (
                    <div key={r.name} className="stp-mcp-row" data-testid="mcp-server">
                      <span className="stp-mono stp-mcp-name" title={r.error}>{r.name}</span>
                      <State word={st.word} tone={st.tone} />
                      <span className="stp-num stp-dim">
                        {st.action === 'signin' && <Btn kind="quiet" onClick={() => notice(`Sign in to ${r.name} from the MCP menu of the thread`)}>Sign in</Btn>}
                        {st.action === 'retry' && <Btn kind="quiet" onClick={() => focusMeta && void window.api.chatMcp(focusMeta.id).then(setMcp)}>Retry</Btn>}
                        {!st.action && r.tools != null ? `${r.tools} tools` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </div>

        <div>
          <Section title="Plan limits" note={planNote || undefined} testid="status-limits">
            {limits.length === 0 ? <Unavailable reason={base?.error ?? 'No usage reading yet'} /> : limits.map((l) => {
              const reset = resetMs(l.resetsAt)
              const f = forecast(readings.get(l.key) ?? [], reset, now)
              const warm = l.pct > WARN_PCT
              return (
                <div key={l.key} className="stp-lim" data-testid="limit-row" data-window={windowOf(l.label, l.key)}>
                  <span className="stp-ln">{l.label}</span>
                  <span className={`stp-lp${warm ? ' warm' : ''}`}>{Math.round(l.pct)}%</span>
                  <Bar pct={l.pct} />
                  <span className="stp-lr">{resetText(l.resetsAt, now)}</span>
                  <span className={`stp-lf${forecastWarns(f) ? ' warn' : ''}`}>{forecastText(f)}</span>
                </div>
              )
            })}
          </Section>

          <Section title="Tokens by thread" note="Today" testid="status-tokens">
            {threads.length === 0 ? <Empty>No threads are open.</Empty> : (
              <table className="dt stp-tbl">
                <thead>
                  <tr><th>Thread</th><th>Models</th><th className="num">Input</th><th className="num">Output</th><th className="num">Cache read</th><th className="num">Context</th><th>State</th></tr>
                </thead>
                <tbody>{threads.map((m) => <ThreadRow key={m.id} meta={m} slot={slots[m.id]} on={m.id === focusMeta?.id} />)}</tbody>
              </table>
            )}
            {threads.length > 0 && Object.values(slots).length > 0 && Object.values(slots).every((s) => !s.res.ok) && (
              <Unavailable reason="Token totals need the main-process update. Context comes from the running thread." />
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function ThreadRow({ meta, slot, on }: { meta: SessionMeta; slot?: Slot; on: boolean }) {
  const st = useThreadStatus(meta.id)
  const v = slot?.res.ok ? slot.res.data : null
  const ctx = v?.context ?? slot?.ctx ?? null
  const t = v?.tokens
  const model = v?.model ?? st.model
  const word = meta.busy ? { w: 'WORKING', t: 'work' as const } : meta.waitingSince ? { w: 'WAITING', t: 'wait' as const } : { w: 'IDLE', t: 'idle' as const }
  return (
    <tr className={on ? 'on' : ''} data-testid="token-row">
      <td className="strong stp-thread">{meta.title}</td>
      <td>{model ? modelLabel(model) : ''}</td>
      <td className="num">{t ? tokens(t.input) : ''}</td>
      <td className="num">{t ? tokens(t.output) : ''}</td>
      <td className="num">{t ? tokens(t.cacheRead) : ''}</td>
      <td className="num">{ctx ? contextShort(ctx.total, ctx.max) : ''}</td>
      <td><State word={word.w} tone={word.t} /></td>
    </tr>
  )
}
