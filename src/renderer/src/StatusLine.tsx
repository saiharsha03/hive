// The status line: the focused thread's branch and context; the 5-hour use (amber above 60%) and the 7-day; MCP;
// the phone; then on the right the Undo of the last list action, Allow my IP (amber when your address changed),
// Pull latest, quiet hours and an update when there is one.
import { useEffect, useState } from 'react'
import { panes as panesStore, useSessionMetas, useStore } from './store'
import { focusedTab } from './panes'
import { notice, openPage, runUndo, undo as undoStore } from './actions'
import { quietHoursGet, allowKnown, type QuietHours, type KnownIp } from './api/next'
import type { AllowStatus } from '../../shared/allowCore'
import type { UpdateState } from '../../shared/versionCore'
import { tokens as fmtTokens, clock, Btn, when } from './kit'
import { useEscape, useFocusTrap } from './ui'
import { useRef } from 'react'
import { pickSettingsSection } from './pages/SettingsPage'

const left = (iso: string | null) => (iso ? clock(Date.parse(iso)) : '')

// Pull latest: every repo fetched and its default branch fast-forwarded; a note when done
let pulling = false
export async function runPull(setBusy?: (b: boolean) => void) {
  if (pulling) return
  pulling = true; setBusy?.(true)
  try {
    const rows = await window.api.pullRun(false)
    const n = (p: string) => rows.filter((r) => r.result.startsWith(p)).length
    const failed = rows.filter((r) => r.result.startsWith('failed'))
    if (failed.length) notice(`Pull latest failed for ${failed.map((r) => r.repo).join(', ')}: ${failed[0].result}`)
    else notice(`Pull latest: ${n('updated')} updated, ${n('skipped')} skipped, ${rows.length - n('updated') - n('skipped')} already up to date`)
  } catch (e) {
    notice(`Pull latest failed: ${(e as Error)?.message ?? e}`)
  } finally { pulling = false; setBusy?.(false) }
}

function AllowPop({ allow, onClose }: { allow: AllowStatus; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEscape(onClose)
  useFocusTrap(box)
  const [known, setKnown] = useState<KnownIp[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void allowKnown().then((r) => setKnown(r.ok ? r.data : null)) }, [])
  const rows: KnownIp[] = known ?? [
    ...(allow.ip ? [{ ip: allow.ip, at: null, label: allow.changed ? 'now, not allowed yet' : 'now, allowed' }] : []),
    ...(allow.lastIp && allow.lastIp !== allow.ip ? [{ ip: allow.lastIp, at: allow.at ? Date.parse(allow.at) : null, label: 'last allowed' }] : []),
  ]
  const run = async () => {
    setBusy(true)
    try {
      const r = await window.api.allowRun()
      notice(r.ok ? `IP allowlist: ${r.ip ?? ''} allowed` : `IP allowlist failed: ${r.output.split('\n').slice(-3).join(' ')}`)
      if (r.ok) onClose()
    } catch (e) { notice(`IP allowlist failed: ${(e as Error)?.message ?? e}`) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="ovl-scrim" style={{ background: 'transparent' }} onMouseDown={onClose} />
      <div className="ip-pop ovl" ref={box} tabIndex={-1} role="dialog" aria-label="Allow my IP" data-testid="allow-pop">
        <div className="poph">Allow my IP<span>{allow.changed ? 'Your address changed' : allow.ip ? 'Your address is allowed' : allow.error || 'Address not read yet'}</span></div>
        {rows.map((r) => (
          <div key={r.ip} className={`ip-row${r.ip === allow.ip && allow.changed ? ' new' : ''}`}>
            <span className="hi">{r.ip === allow.ip ? 'This computer' : 'Before'}</span><span className="a">{r.ip}</span>
            <span className="w">{r.label ?? ''}{r.at ? `${r.label ? ', ' : ''}${when(r.at)}` : ''}</span>
          </div>
        ))}
        {!rows.length && <div className="ip-row"><span className="dimt">No address known yet.</span></div>}
        <div className="ip-foot"><span>Runs your allowlist command for the address this computer has now.</span>
          <Btn kind="plain" onClick={onClose}>Close</Btn>
          <Btn kind="primary" onClick={() => void run()} disabled={busy || allow.running} testid="dock-allow">{busy || allow.running ? 'Allowing' : 'Allow now'}</Btn></div>
      </div>
    </>
  )
}

export function StatusLine() {
  const metas = useSessionMetas()
  const focus = useStore(panesStore, focusedTab)
  const f = metas.find((s) => s.id === focus && !s.tool && !s.file)
  const u = useStore(undoStore, (x) => x)
  const [status, setStatus] = useState<Status | null>(null)
  const [ctx, setCtx] = useState<{ total: number; max: number } | null>(null)
  const [phone, setPhone] = useState<{ paired: boolean; connected: boolean } | null>(null)
  const [allow, setAllow] = useState<AllowStatus | null>(null)
  const [allowOpen, setAllowOpen] = useState(false)
  const [busyPull, setBusyPull] = useState(false)
  const [quiet, setQuiet] = useState<QuietHours | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEffect(() => {
    const load = () => void window.api.getStatus().then(setStatus).catch(() => {})
    load()
    const t = setInterval(load, 15_000)
    void window.api.mobileStatus().then(setPhone).catch(() => {})
    const offPhone = window.api.onMobileStatus(setPhone)
    void window.api.allowStatus().then(setAllow).catch(() => {})
    const offAllow = window.api.onAllowStatus(setAllow)
    void quietHoursGet().then((r) => setQuiet(r.ok ? r.data : null))
    void window.api.updateState().then(setUpdate).catch(() => {})
    const offUpd = window.api.onUpdateState(setUpdate)
    return () => { clearInterval(t); offPhone(); offAllow(); offUpd() }
  }, [])
  useEffect(() => {
    setCtx(null)
    if (!f) return
    let alive = true
    const load = () => void window.api.chatContext(f.id).then((c) => { if (alive) setCtx(c) }).catch(() => {})
    load()
    const t = setInterval(load, 10_000)
    return () => { alive = false; clearInterval(t) }
  }, [f?.id, f?.busy])
  const branch = f ? (f.worktrees?.at(-1)?.branch ?? (f.cwd ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? '') : ''
  const five = status?.five, seven = status?.seven
  const c = status?.connectors
  return (
    <footer className="sline" data-testid="status-bar">
      {branch && <span className="branch" data-testid="status-branch">{branch}</span>}
      {ctx && <span data-testid="status-context">Context <b className="num">{fmtTokens(ctx.total)}</b>{ctx.max ? <> of <b>{fmtTokens(ctx.max)}</b></> : null}</span>}
      {five?.pct != null && <button className={five.pct > 60 ? 'warm' : ''} onClick={() => openPage('status')} data-testid="status-five">5-hour <b className="num">{Math.round(five.pct)}%</b>{five.resetsAt ? `, resets ${left(five.resetsAt)}` : ''}</button>}
      {seven?.pct != null && <button className={seven.pct > 60 ? 'warm' : ''} onClick={() => openPage('status')} data-testid="status-seven">7-day <b className="num">{Math.round(seven.pct)}%</b></button>}
      {c && <button onClick={() => openPage('status')} className={c.failed ? 'warm' : ''} data-testid="status-mcp">MCP <b className="num">{c.connected} of {c.total}</b>{c.needsAuth ? `, ${c.needsAuth} needs sign-in` : ''}{c.failed ? `, ${c.failed} failed` : ''}</button>}
      {phone?.paired && <span data-testid="status-phone">{phone.connected ? 'Phone paired' : 'Phone away'}</span>}
      <span className="r" />
      {u && <span className="undo" data-testid="undo-line">{u.text}<button onClick={() => runUndo()} data-testid="undo">Undo</button></span>}
      {update && <button className="hi" onClick={() => void window.api.updateApply()} data-testid="status-update">{update.kind === 'ready' ? `Restart to update to ${update.version}` : `Hive ${update.version} available`}</button>}
      {allow?.configured && <button className={allow.changed ? 'warm' : ''} onClick={() => setAllowOpen(true)} title={allow.ip ? `Your address: ${allow.ip}` : allow.error} data-testid="status-allow">{allow.running ? 'Allowing your IP' : 'Allow my IP'}</button>}
      <button onClick={() => void runPull(setBusyPull)} disabled={busyPull} data-testid="status-pull">{busyPull ? 'Pulling' : 'Pull latest'}</button>
      <button onClick={() => { pickSettingsSection('notify'); openPage('settings') }} data-testid="status-quiet">{quiet?.on ? `Quiet hours from ${quiet.from}` : 'Quiet hours off'}</button>
      {allowOpen && allow && <AllowPop allow={allow} onClose={() => setAllowOpen(false)} />}
    </footer>
  )
}
