// The status line, all faint: the focused thread's branch, its context and the 7-day use each with a small meter; then
// on the right where this computer's address stands (in the signal colour only when it is not allowed: that needs
// you), the phone, quiet hours, and the Undo of the last list action or an update or Pull latest.
import { useEffect, useState } from 'react'
import { createStore, panes as panesStore, useSessionMetas, useStore } from './store'
import { focusedTab } from './panes'
import { notice, openPage, runUndo, undo as undoStore } from './actions'

type KnownIp = { ip: string; at: number | null; label?: string }
import type { AllowStatus } from '../../shared/allowCore'
import type { UpdateState } from '../../shared/versionCore'
import { tokens as fmtTokens, Btn, when, WARN_PCT } from './kit'
import { useQuietHours } from './api/next'
import { useEscape, useFocusTrap } from './ui'
import { useRef } from 'react'

// a small meter after a number
const Meter = ({ pct }: { pct: number }) => <span className={`meter${pct > WARN_PCT ? ' warm' : ''}`} aria-hidden><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
// inside the quiet window now (it may wrap past midnight)
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0) }
const inQuiet = (from: string, to: string, d = new Date()) => { const n = d.getHours() * 60 + d.getMinutes(), a = minutes(from), b = minutes(to); return a <= b ? n >= a && n < b : n >= a || n < b }

// Pull latest: every repo fetched and its default branch fast-forwarded; a note when done
let pulling = false
export async function runPull(setBusy?: (b: boolean) => void) {
  if (pulling) return
  pulling = true; setBusy?.(true)
  try {
    const rows = await window.api.pullRun(false)
    const n = (p: string) => rows.filter((r) => r.result.startsWith(p)).length
    const failed = rows.filter((r) => r.result.startsWith('failed'))
    // anything that is neither updated nor up to date (skipped, refused in test mode) is said as it is, never counted as fine
    const other = rows.filter((r) => !/^(updated|already up to date|failed)/.test(r.result))
    if (failed.length) notice(`Pull latest failed for ${failed.map((r) => r.repo).join(', ')}: ${failed[0].result}`)
    else notice([`Pull latest: ${n('updated')} updated, ${n('already up to date')} already up to date`, ...other.slice(0, 3).map((r) => `${r.repo}: ${r.result}`), ...(other.length > 3 ? [`${other.length - 3} more skipped`] : [])].join('; '))
  } catch (e) {
    notice(`Pull latest failed: ${(e as Error)?.message ?? e}`)
  } finally { pulling = false; setBusy?.(false) }
}

// The last run of the allowlist command: what it printed, kept so the editor area can show it. One run at a time.
export type AllowOut = { running: boolean; ok: boolean | null; ip: string | null; output: string; at: number | null }
export const allowOut = createStore<AllowOut>({ running: false, ok: null, ip: null, output: '', at: null })
export async function runAllow(): Promise<{ ok: boolean } | null> {
  if (allowOut.get().running) return null
  allowOut.set({ ...allowOut.get(), running: true })
  try {
    const r = await window.api.allowRun()
    allowOut.set({ running: false, ok: r.ok, ip: r.ip ?? null, output: r.output, at: Date.now() })
    notice(r.ok ? `IP allowlist: ${r.ip ?? ''} allowed` : `IP allowlist failed: ${r.output.split('\n').slice(-3).join(' ')}`)
    return { ok: r.ok }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    allowOut.set({ running: false, ok: false, ip: null, output: msg, at: Date.now() })
    notice(`IP allowlist failed: ${msg}`)
    return { ok: false }
  }
}

// Allow my IP, as a body: the addresses and the Allow now button. The status line shows it in a pop-up (with Close),
// the side bar's Allow IP view shows it as it is.
export function AllowBody({ allow, onClose }: { allow: AllowStatus; onClose?: () => void }) {
  const [busy, setBusy] = useState(false)
  // every address the command succeeded for (main keeps them, newest first), else what the status says
  const fromStatus = allow.known
  const rows: KnownIp[] = (fromStatus?.length ? [
    ...(allow.ip && !fromStatus.some((k) => k.ip === allow.ip) ? [{ ip: allow.ip, at: null, label: 'now, not allowed yet' }] : []),
    ...fromStatus.map((k) => ({ ip: k.ip, at: Date.parse(k.at), label: `${k.ip === allow.ip ? 'now, allowed' : 'allowed before'}${k.trusted ? '' : ', expired'}` })),
  ] : null) ?? [
    ...(allow.ip ? [{ ip: allow.ip, at: null, label: allow.changed ? 'now, not allowed yet' : 'now, allowed' }] : []),
    ...(allow.lastIp && allow.lastIp !== allow.ip ? [{ ip: allow.lastIp, at: allow.at ? Date.parse(allow.at) : null, label: 'last allowed' }] : []),
  ]
  const run = async () => {
    setBusy(true)
    try { const r = await runAllow(); if (r?.ok) onClose?.() } finally { setBusy(false) }
  }
  return (
    <>
      <div className="poph">Allow my IP<span>{allow.changed ? 'Your address is not allowed yet' : allow.ip ? 'Your address is allowed' : allow.unreadable ? 'Could not read your public address' : allow.error || 'Address not read yet'}</span></div>
      {rows.map((r) => (
        <div key={r.ip} className={`ip-row${r.ip === allow.ip && allow.changed ? ' new' : ''}`}>
          <span className="hi">{r.ip === allow.ip ? 'This computer' : 'Before'}</span><span className="a">{r.ip}</span>
          <span className="w">{r.label ?? ''}{r.at ? `${r.label ? ', ' : ''}${when(r.at)}` : ''}
            {r.at && fromStatus?.some((k) => k.ip === r.ip) && <> <Btn kind="link" onClick={() => void window.api.allowForget(r.ip).then(() => notice(`Forgot ${r.ip}: Allow my IP offers it again`)).catch((e) => notice(`Could not forget ${r.ip}: ${e?.message ?? e}`))} testid={`allow-forget-${r.ip}`} title="Its rule is gone on the other side: forget it, so Allow my IP offers it again">Forget</Btn></>}</span>
        </div>
      ))}
      {!rows.length && <div className="ip-row"><span className="dimt">No address known yet.</span></div>}
      <div className="ip-foot"><span>Runs your allowlist command for the address this computer has now.</span>
        {onClose && <Btn kind="plain" onClick={onClose}>Close</Btn>}
        {allow.changed && allow.ip && <Btn kind="plain" onClick={() => void window.api.allowMark().then(() => notice(`${allow.ip} kept as already allowed`)).catch((e) => notice(String(e?.message ?? e)))} testid="allow-mark" title="This address is already allowed on the other side: remember it, without running the command">Already allowed</Btn>}
        <Btn kind="primary" onClick={() => void run()} disabled={busy || allow.running} testid="dock-allow">{busy || allow.running ? 'Allowing' : 'Allow now'}</Btn></div>
    </>
  )
}

// this computer's address and whether it is allowed, kept current
export function useAllow(): AllowStatus | null {
  const [allow, setAllow] = useState<AllowStatus | null>(null)
  useEffect(() => {
    void window.api.allowStatus().then(setAllow).catch(() => {})
    return window.api.onAllowStatus(setAllow)
  }, [])
  return allow
}

function AllowPop({ allow, onClose }: { allow: AllowStatus; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEscape(onClose)
  useFocusTrap(box)
  return (
    <>
      <div className="ovl-scrim" style={{ background: 'transparent' }} onMouseDown={onClose} />
      <div className="ip-pop ovl" ref={box} tabIndex={-1} role="dialog" aria-label="Allow my IP" data-testid="allow-pop">
        <AllowBody allow={allow} onClose={onClose} />
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
  const [allow, setAllow] = useState<AllowStatus | null>(null)
  const [allowOpen, setAllowOpen] = useState(false)
  const [busyPull, setBusyPull] = useState(false)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [phone, setPhone] = useState<{ configured: boolean; paired: boolean; connected: boolean } | null>(null)
  const quiet = useQuietHours()
  useEffect(() => {
    void window.api.mobileStatus().then(setPhone).catch(() => {})
    return window.api.onMobileStatus(setPhone)
  }, [])
  useEffect(() => {
    const load = () => void window.api.getStatus().then(setStatus).catch(() => {})
    load()
    const t = setInterval(load, 15_000)
    void window.api.allowStatus().then(setAllow).catch(() => {})
    const offAllow = window.api.onAllowStatus(setAllow)
    void window.api.updateState().then(setUpdate).catch(() => {})
    const offUpd = window.api.onUpdateState(setUpdate)
    return () => { clearInterval(t); offAllow(); offUpd() }
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
  const seven = status?.seven
  const ipWord = !allow ? '' : allow.running ? 'Allowing this address' : allow.changed ? 'New address, not allowed' : allow.ip ? 'Address allowed' : allow.unreadable ? 'Address not read' : 'Allow my IP'
  return (
    <footer className="sline" data-testid="status-bar">
      {branch && <b className="branch" data-testid="status-branch">{branch}</b>}
      {ctx && <span data-testid="status-context">Context {fmtTokens(ctx.total)}{ctx.max ? ` of ${fmtTokens(ctx.max)}` : ''}{ctx.max ? <Meter pct={(ctx.total / ctx.max) * 100} /> : null}</span>}
      {seven?.pct != null && <button className={seven.pct > WARN_PCT ? 'warm' : ''} onClick={() => openPage('status')} title="Status and usage" data-testid="status-seven">7-day {Math.round(seven.pct)}%<Meter pct={seven.pct} /></button>}
      <span className="r" />
      {allow?.configured && <button className={allow.changed ? 'warm' : ''} onClick={() => setAllowOpen(true)} title={allow.ip ? `This computer's address: ${allow.ip}. Click for Allow my IP` : allow.error || 'Allow my IP'} data-testid="status-allow">{ipWord}</button>}
      {phone?.configured && <button onClick={() => openPage('settings')} title={phone.connected ? 'The phone app is connected' : 'Pairing and the relay are in Settings'} data-testid="status-phone">{phone.paired ? 'Phone paired' : 'Phone not paired'}</button>}
      {quiet?.on && <button onClick={() => openPage('settings')} title={`Quiet hours ${quiet.from} to ${quiet.to}: notifications stay silent`} data-testid="status-quiet">{inQuiet(quiet.from, quiet.to) ? `Quiet until ${quiet.to}` : `Quiet from ${quiet.from}`}</button>}
      {u ? <span className="undo" data-testid="undo-line">{u.text}<button onClick={() => runUndo()} data-testid="undo">Undo</button></span>
        : update ? <button className="hi" onClick={() => void window.api.updateApply()} data-testid="status-update">{update.kind === 'ready' ? `Restart to update to ${update.version}` : `Hive ${update.version} available`}</button>
          : <button onClick={() => void runPull(setBusyPull)} disabled={busyPull} data-testid="status-pull">{busyPull ? 'Pulling' : 'Pull latest'}</button>}
      {allowOpen && allow && <AllowPop allow={allow} onClose={() => setAllowOpen(false)} />}
    </footer>
  )
}
