// The status bar along the bottom (VS Code style): the brand, the focused thread's branch, waiting / working counts
// on the left; account and plan, 5-hour and 7-day usage, context and cache, model, MCP and the UI on the right.
// Colour only where something needs attention.
import { useEffect, useState, type ReactNode } from 'react'
import { useAppName } from './appSettings'
import { HiveMark } from './HiveMark'
import { ModelBadge } from './ThreadStatus'
import { getThemes, getUIs, useAppearance } from './appearance'
import { Icon, Popover, anchorOf, type Anchor } from './ui'
import { AccountSwitch } from './AccountSwitch'
import type { UpdateState } from '../../shared/versionCore'

const left = (iso: string | null, now: number) => {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}
const tone = (pct: number) => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok')
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

const Meter = ({ pct, t }: { pct: number; t: string }) => <span className={`meter m-${t}`}><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span>

function Item({ children, title, onClick, testid, cls = '' }: { children: ReactNode; title?: string; onClick?: (el: HTMLElement) => void; testid: string; cls?: string }) {
  return onClick
    ? <button className={`sbi ${cls}`} title={title} onClick={(e) => onClick(e.currentTarget)} data-testid={testid}>{children}</button>
    : <span className={`sbi ${cls}`} title={title} data-testid={testid}>{children}</span>
}

type Props = {
  sessionPath: string | null; tabId: string | null; branch: string | null
  waiting: number; working: number; failed: number
  onWaiting: (el: HTMLElement) => void; onWorking: (el: HTMLElement) => void; onMcp: (el: HTMLElement) => void; onAppearance: (el: HTMLElement) => void; onBrand: () => void
}

export function StatusBar({ sessionPath, tabId, branch, waiting, working, failed, onWaiting, onWorking, onMcp, onAppearance, onBrand }: Props) {
  const [ctx, setCtx] = useState<{ total: number; max: number } | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [switching, setSwitching] = useState(false)
  const [usageAt, setUsageAt] = useState<Anchor | null>(null)
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [now, setNow] = useState(Date.now())
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const name = useAppName()
  const { ui, theme } = useAppearance()

  // account, limits and connectors: every 15 s (a live thread's limits read in a few ms)
  useEffect(() => {
    const load = () => window.api.getStatus().then(setStatus).catch(() => {})
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])
  // a new Hive release: downloaded and waiting for a restart, or (portable) available on GitHub
  useEffect(() => {
    window.api.updateState().then(setUpdate).catch(() => {})
    return window.api.onUpdateState(setUpdate)
  }, [])
  // the focused thread: on switch and every 10 s
  useEffect(() => {
    setStats(null); setCtx(null)
    if (!sessionPath && !tabId) return
    const load = () => {
      if (sessionPath) window.api.sessionStats(sessionPath).then(setStats).catch(() => {})
      if (tabId) window.api.chatContext(tabId).then(setCtx).catch(() => setCtx(null))
    }
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [sessionPath, tabId])
  // clock for the cache countdown and reset times
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const c = status?.connectors
  const cacheLeft = stats?.lastReplyAt ? stats.lastReplyAt + stats.cacheTtlMs - now : null
  const ctxTotal = ctx?.total ?? stats?.contextTokens ?? null
  const ctxMax = ctx?.max ?? null
  // a reading over 10 minutes old is shown greyed with its time, not passed off as current
  const asOf = status?.usageAt && now - status.usageAt > 10 * 60_000 ? new Date(status.usageAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
  const lim = (label: string, l: Limit, id: string) => l && l.pct !== null && (
    <Item testid={`status-${id}`} cls={asOf ? 's-idle' : undefined} title={`${l.resetsAt ? `${label} limit, resets in ${left(l.resetsAt, now)}` : `${label} limit`}${asOf ? `, as of ${asOf}` : ''}. Click for all limits`} onClick={(el) => setUsageAt(anchorOf(el))}>
      <span className="lbl">{label}</span><Meter pct={l.pct} t={tone(l.pct)} /><span className={tone(l.pct) === 'ok' ? '' : `s-${tone(l.pct) === 'bad' ? 'fail' : 'wait'}`}>{Math.round(l.pct)}%</span>
      {l.resetsAt && <span className="lbl">resets {left(l.resetsAt, now)}</span>}
    </Item>
  )

  return (
    <footer className="statusbar" data-testid="status-bar">
      <button className="sbi brand" onClick={onBrand} title="Command palette (Ctrl+K)" data-testid="status-brand"><HiveMark size={14} />{name}</button>
      {branch && <Item testid="status-branch" title="The focused thread's branch or folder"><Icon name="git-branch" />{branch}</Item>}
      {waiting > 0 && <Item testid="live-waiting" cls="s-wait" title="Threads waiting for you" onClick={onWaiting}><Icon name="bell-dot" className="blink" />{waiting} waiting</Item>}
      {working > 0 && <Item testid="live-working" cls="s-work" title="Threads working" onClick={onWorking}><Icon name="loading" className="spin" />{working} working</Item>}
      {failed > 0 && <Item testid="status-failed" cls="s-fail" title="Threads that failed"><Icon name="error" />{failed}</Item>}
      {status?.error && <Item testid="status-error" cls="s-fail" title={status.error}><Icon name="warning" />status error</Item>}
      <span className="sp" />
      {update && (
        <Item testid="status-update" cls="s-done" title={update.kind === 'ready' ? `Hive ${update.version} is downloaded. Click to restart into it (it also installs when you quit)` : `Hive ${update.version} is on GitHub. Click to open the release`} onClick={() => void window.api.updateApply()}>
          <Icon name={update.kind === 'ready' ? 'sync' : 'cloud-download'} />{update.kind === 'ready' ? `Restart to update to v${update.version}` : `v${update.version} available`}
        </Item>
      )}
      {!status && <Item testid="status-connecting">Connecting…</Item>}
      {status?.account && <Item testid="status-account" onClick={() => setSwitching(true)} title={`${status.engine?.version ? `Claude Code ${status.engine.version}${status.engine.installed ? '' : ' (bundled with the SDK)'}. ` : ''}Click to switch account`}><Icon name="account" />{status.account}{status.plan ? `, ${status.plan[0].toUpperCase()}${status.plan.slice(1)}` : ''}</Item>}
      {status && lim('5h', status.five, 'five')}
      {status && lim('7d', status.seven, 'seven')}
      {asOf && (status?.five || status?.seven) && <span className="sbi s-idle" data-testid="status-usage-asof">as of {asOf}</span>}
      {ctxTotal != null && (
        <Item testid="status-context" title={ctxMax ? 'Context window of the focused thread' : 'Window known once the session runs'}>
          <span className="lbl">ctx</span>{ctxMax ? <Meter pct={(ctxTotal / ctxMax) * 100} t={tone((ctxTotal / ctxMax) * 100)} /> : null}{k(ctxTotal)}{ctxMax ? ` / ${k(ctxMax)}` : ''}
        </Item>
      )}
      {cacheLeft != null && (
        <Item testid="status-cache" cls={cacheLeft > 0 ? '' : 's-fail'} title={stats?.compactions ? `${stats.compactions} compaction(s) in this thread` : 'Prompt cache'}>
          <Icon name="flame" className={cacheLeft > 0 ? 's-done' : ''} />{cacheLeft > 0 ? `cache warm ${mmss(cacheLeft)}` : 'cache cold'}
        </Item>
      )}
      <ModelBadge tabId={tabId} />
      {c && (
        <Item testid="status-mcp" cls={c.failed ? 's-fail' : c.needsAuth ? 's-wait' : ''} title="MCP servers" onClick={onMcp}>
          <Icon name="plug" />MCP {c.connected}/{c.total}{c.needsAuth ? `, ${c.needsAuth} sign-in` : ''}{c.failed ? `, ${c.failed} failed` : ''}
        </Item>
      )}
      <Item testid="status-appearance" title="UI and theme" onClick={onAppearance}><Icon name="layout" />{getUIs().find((u) => u.id === ui)?.label} UI, {getThemes(ui).find((t) => t.id === theme)?.label} theme</Item>
      {usageAt && status && (
        <Popover anchor={usageAt} onClose={() => setUsageAt(null)} width={300} align="right" testid="usage-pop">
          <div className="usage-pop">
            <b>Plan usage{status.plan ? ` (${status.plan[0].toUpperCase()}${status.plan.slice(1)})` : ''}</b>
            {!status.usage?.length && <div className="hint">No reading yet.</div>}
            {status.usage?.map((r) => (
              <div key={r.key} className="usage-row" data-testid={`usage-${r.key}`}>
                <div>{r.label}</div>
                <div><Meter pct={r.pct} t={tone(r.pct)} /> {Math.round(r.pct)}% used{r.resetsAt ? `, resets in ${left(r.resetsAt, now)}` : ''}</div>
              </div>
            ))}
          </div>
        </Popover>
      )}
      {switching && <AccountSwitch current={status?.account ?? null} working={working} onClose={() => setSwitching(false)} />}
    </footer>
  )
}
