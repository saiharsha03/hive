// The account popover under the title bar: the saved accounts with plan and use, a switch that takes effect at once
// (main: accounts:switch, no browser), Add account (the browser sign-in, saved too) and Remove (forgets a saved login).
// Nothing restarts: quiet threads move to the new login at once, working ones when their work ends.
import { getPref, setPref } from './prefs'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Bar, Btn, ConfirmBar, State, Unavailable } from './kit'
import { accountsList, accountsRemove, accountsSwitch, onAccountSwitched, onAccountsChanged, type Account, type UsageRow } from './api/next'
import { notice } from './actions'
import { useEscape, useFocusTrap } from './ui'
import { windowOf } from './pages/statusCore'
import './pages/status.css'

type Row = { id: string; name: string; email: string | null; plan: string | null; five: number | null; seven: number | null; threads: number | null; inUse: boolean; asOf?: number }

const pick = (limits: UsageRow[] | undefined, w: 'five' | 'seven'): number | null => {
  const r = limits?.find((l) => windowOf(l.label, l.key) === w)
  return r ? Math.round(r.pct) : null
}
const fromAccount = (a: Account): Row => ({ id: a.id, name: a.label, email: a.email, plan: a.plan, five: pick(a.limits, 'five'), seven: pick(a.limits, 'seven'), threads: a.threads ?? null, inUse: a.inUse })

// force: the limits are asked for now, the way /usage does, not taken from the last quiet reading
async function load(force = false): Promise<{ rows: Row[]; several: boolean }> {
  const r = await accountsList()
  const s = await window.api.getStatus(force).catch(() => null)
  if (r.ok && r.data.length) {
    // Only the login in use can be asked for its limits. Its reading is kept per account, so an account that is not
    // in use shows the last one taken while it was (with its time), instead of an empty bar.
    const kept = getPref<Record<string, { five: number | null; seven: number | null; at: number }>>('accountLimits', {})
    const rows = r.data.map(fromAccount).map((row) => {
      const key = (row.email ?? row.id).toLowerCase()
      if (row.inUse && s) {
        const five = s.five?.pct ?? pick(s.usage, 'five'), seven = s.seven?.pct ?? pick(s.usage, 'seven')
        if (five != null || seven != null) {
          const now = { five: five == null ? null : Math.round(five), seven: seven == null ? null : Math.round(seven), at: s.usageAt ?? Date.now() }
          if (kept[key]?.at !== now.at) setPref('accountLimits', { ...kept, [key]: now })
          return { ...row, five: now.five, seven: now.seven }
        }
      }
      const old = kept[key]
      return old && row.five == null && row.seven == null ? { ...row, five: old.five, seven: old.seven, asOf: row.inUse ? undefined : old.at } : row
    })
    return { rows, several: true }
  }
  if (!s?.account) return { rows: [], several: false }
  const five = s.five?.pct ?? pick(s.usage, 'five')
  const seven = s.seven?.pct ?? pick(s.usage, 'seven')
  return {
    rows: [{ id: 'current', name: s.account.split('@')[0], email: s.account, plan: s.plan, five: five == null ? null : Math.round(five), seven: seven == null ? null : Math.round(seven), threads: null, inUse: true }],
    several: r.ok,
  }
}

// name, plan and the two percentages for the title bar; refreshed every 60 s
export function useAccountSummary(): { label: string; plan: string; five: number | null; seven: number | null } {
  const [sum, setSum] = useState<{ label: string; plan: string; five: number | null; seven: number | null }>({ label: '', plan: '', five: null, seven: null })
  useEffect(() => {
    let live = true
    const run = () => void load().then(({ rows }) => {
      const r = rows.find((x) => x.inUse) ?? rows[0]
      if (live && r) setSum({ label: r.name, plan: r.plan ?? '', five: r.five, seven: r.seven })
    }).catch(() => {})
    run()
    const t = setInterval(run, 60_000)
    const off = onAccountsChanged(run)
    return () => { live = false; clearInterval(t); off() }
  }, [])
  return sum
}

// page: drawn in place as a whole page (the Accounts section), not as a pop-up over the window
export function AccountSwitcher({ onClose, page = false }: { onClose: () => void; page?: boolean }) {
  const idle = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ rows: Row[]; several: boolean } | null>(null)
  const [sel, setSel] = useState(0)
  const [flow, setFlow] = useState<'off' | 'ask' | 'signing' | 'done' | 'failed'>('off')
  // after a switch: the new login, and how many threads move when their work ends
  const [moved, setMoved] = useState<{ account: string | null; closed: number; waiting: number } | null>(null)
  useEffect(() => onAccountSwitched(setMoved), [])
  const [email, setEmail] = useState('')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<{ text: string; bad: boolean; signIn?: string } | null>(null)
  const [forgetting, setForgetting] = useState<string | null>(null) // row id whose Remove awaits its confirm
  useEscape(() => {
    if (forgetting) { setForgetting(null); return }
    if (flow === 'signing') void window.api.accountCancel()
    onClose()
  }, !page)
  useFocusTrap(page ? idle : box)

  const refresh = useCallback(() => void load(true).then((s) => { setState(s); setSel((i) => (i === 0 ? Math.max(0, s.rows.findIndex((r) => r.inUse)) : i)) }), [])
  useEffect(() => { refresh(); return onAccountsChanged(refresh) }, [refresh])
  useEffect(() => onAccountSwitched(refresh), [refresh])
  useEffect(() => window.api.onAccountOutput((t) => setOut((o) => o + t)), [])

  const rows = state?.rows ?? []
  const several = state?.several ?? false
  const saved = (r: Row) => several && r.id !== 'current'

  const switchTo = async (r: Row) => {
    if (r.inUse || !saved(r) || busy) return
    setBusy(r.id); setSaid(null)
    const res = await accountsSwitch(r.id)
    setBusy(null)
    if (!res.ok) { setSaid({ text: `Could not switch: ${res.reason}`, bad: true }); return }
    const d = res.data
    const warn = d.warning ? ` ${d.warning}` : ''
    if (d.ok) {
      setSaid({ text: `Switched to ${d.account ?? r.name}${d.waiting ? `; ${d.waiting} thread${d.waiting > 1 ? 's' : ''} move when ${d.waiting > 1 ? 'they finish' : 'it finishes'}` : ''}.${warn}`, bad: false })
      notice(`New threads use ${r.name}`)
    } else {
      setSaid({ text: `${d.error ?? 'The switch did not finish.'}${warn}`, bad: true, ...(d.needsSignIn && r.email ? { signIn: r.email } : {}) })
    }
  }
  const forget = async (r: Row) => {
    setForgetting(null)
    const res = await accountsRemove(r.id)
    if (!res.ok) notice(`Could not remove ${r.name}: ${res.reason}`)
    else if (!res.data) notice(`Could not remove ${r.name}`)
    else refresh()
  }
  const start = async () => {
    setFlow('signing'); setOut(''); setSaid(null)
    const r = await window.api.accountSwitch(email)
    setOut((o) => o || r.output)
    setFlow(r.ok ? 'done' : 'failed')
  }
  const cancel = () => { void window.api.accountCancel(); setFlow('off') }

  const keys = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || !rows.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
      setSel(n)
      box.current?.querySelectorAll<HTMLElement>('.acct-row')[n]?.focus()
    } else if (e.key === 'Enter' && (e.target as HTMLElement).classList.contains('acct-row')) {
      e.preventDefault()
      void switchTo(rows[sel])
    }
  }

  return (
    <div className={page ? 'acct-page-wrap' : 'ovl-scrim'} onMouseDown={(e) => { if (!page && e.target === e.currentTarget) onClose() }}>
      <div className={page ? 'acct-pop acct-page' : 'acct-pop'} ref={box} role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : 'true'} aria-label="Accounts" tabIndex={-1} onKeyDown={keys} data-testid="account-switcher">
        <div className="poph">Accounts <span>Switching is instant. Running threads are not restarted.</span></div>
        {state && rows.length === 0 && <Unavailable reason="No signed-in account was found." />}
        {rows.map((r, i) => (
          <Fragment key={r.id}>
            <div
              className={`acct-row${r.inUse ? ' on' : ''}`}
              role="option"
              aria-selected={r.inUse}
              tabIndex={i === sel ? 0 : -1}
              onFocus={() => setSel(i)}
              data-testid="account-row"
            >
              <div className="acct-name"><b>{r.name}</b><span>{r.email ?? ''}</span></div>
              <div className="acct-plan">{r.plan ?? ''}</div>
              <div className="acct-use">
                {r.five == null && r.seven == null ? <span className="acct-nolim" data-testid="account-nolimits">{r.inUse ? 'Limits not read yet' : 'Limits show after this account has been in use'}{r.inUse && <> <Btn kind="link" onClick={(e) => { e.stopPropagation(); refresh() }} testid="account-read-limits">Read now</Btn></>}</span> : <>
                  <span>5h</span><span className="acct-bar"><Bar pct={r.five ?? 0} tone={(r.five ?? 0) >= 90 ? 'fail' : (r.five ?? 0) >= 75 ? 'wait' : 'accent'} /><em className="acct-pct">{r.five == null ? '' : `${r.five}%`}</em></span>
                  <span>7d</span><span className="acct-bar"><Bar pct={r.seven ?? 0} tone={(r.seven ?? 0) >= 90 ? 'fail' : (r.seven ?? 0) >= 75 ? 'wait' : 'accent'} /><em className="acct-pct">{r.seven == null ? '' : `${r.seven}%`}</em></span>
                  {r.asOf && <span className="acct-asof">as of {new Date(r.asOf).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                </>}
              </div>
              <div className="acct-threads">{r.threads == null ? '' : `${r.threads} thread${r.threads === 1 ? '' : 's'}`}</div>
              <div className="acct-act">
                {r.inUse
                  ? <State word="IN USE" tone="done" />
                  : saved(r) && <Btn kind="link" disabled={!!busy} onClick={() => void switchTo(r)} testid="account-use">{busy === r.id ? 'Switching' : 'Switch'}</Btn>}
                {saved(r) && <Btn kind="link" className="x" onClick={() => setForgetting(r.id)} testid="account-remove">Remove</Btn>}
              </div>
            </div>
            {forgetting === r.id && (
              <ConfirmBar
                testid="account-remove-confirm"
                actions={<><Btn kind="danger" onClick={() => void forget(r)} testid="account-remove-yes">Remove</Btn><Btn kind="plain" onClick={() => setForgetting(null)} testid="account-remove-no">Keep it</Btn></>}
              >
                Forget the saved login for {r.email ?? r.name}? The account itself is not touched; you can add it again by signing in.
              </ConfirmBar>
            )}
          </Fragment>
        ))}

        {said && (
          <div className={said.bad ? 'derr' : 'acct-dim'} data-testid="account-said">
            {said.text}
            {said.signIn && <> <Btn kind="link" onClick={() => { setEmail(said.signIn!); setSaid(null); setFlow('ask') }}>Sign in to {said.signIn} in the browser</Btn></>}
          </div>
        )}

        <div className="acct-old">
          {flow === 'ask' && (
            <div className="acct-flow">
              <input className="uline" autoFocus value={email} placeholder="Email to pre-fill (optional)" aria-label="Email" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void start() }} data-testid="account-email" />
              <Btn kind="primary" onClick={() => void start()} testid="account-signin">Sign in</Btn>
              <Btn kind="plain" onClick={() => setFlow('off')}>Cancel</Btn>
            </div>
          )}
          {flow !== 'off' && flow !== 'ask' && (
            <>
              <pre className="log acct-log" data-testid="account-log">{out || (flow === 'signing' ? 'Finish signing in in the browser.' : '')}</pre>
              <div className="acct-flow">
                {flow === 'signing' && <Btn kind="plain" onClick={cancel} testid="account-cancel">Cancel</Btn>}
                {flow === 'done' && <span className="acct-dim" data-testid="account-done">{moved ? `Switched to ${moved.account ?? 'the new account'}${moved.waiting ? `; ${moved.waiting} thread${moved.waiting > 1 ? 's' : ''} move when ${moved.waiting > 1 ? 'they finish' : 'it finishes'}` : ''}.` : 'Signed in. Moving the threads to the new login.'}</span>}
                {flow === 'failed' && <span className="acct-dim">The sign-in did not finish; nothing changed.</span>}
                {(flow === 'done' || flow === 'failed') && <Btn kind="plain" onClick={() => setFlow('off')}>Close</Btn>}
              </div>
            </>
          )}
        </div>

        <div className="acct-foot">
          <span data-testid="account-warning">New threads use the account in use. A running thread keeps its account until its work ends. Other Claude sessions (a terminal or an IDE) keep the old login until restarted and may write it back; close them for a clean switch.</span>
          {flow === 'off' && <Btn kind="quiet" onClick={() => setFlow('ask')} testid="account-add">Add account</Btn>}
        </div>
      </div>
    </div>
  )
}
