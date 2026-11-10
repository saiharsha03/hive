// The account popover under the title bar: every signed-in account with its plan, 5-hour and 7-day use and thread
// count, and a switch that takes effect at once. Until main can hold several accounts (accountsList), it shows the
// one account getStatus() knows and offers the browser sign-in: nothing restarts, threads move to the new login.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bar, Btn, State, Unavailable } from './kit'
import { accountAdd, accountsList, accountUse, onAccountsChanged, threadAccount, type Account, type UsageRow } from './api/next'
import { activeId, notice } from './actions'
import { useEscape, useFocusTrap } from './ui'
import { windowOf } from './pages/statusCore'
import './pages/status.css'

type Row = { id: string; name: string; email: string | null; plan: string | null; five: number | null; seven: number | null; threads: number | null; inUse: boolean }

const pick = (limits: UsageRow[] | undefined, w: 'five' | 'seven'): number | null => {
  const r = limits?.find((l) => windowOf(l.label, l.key) === w)
  return r ? Math.round(r.pct) : null
}
const fromAccount = (a: Account): Row => ({ id: a.id, name: a.label, email: a.email, plan: a.plan, five: pick(a.limits, 'five'), seven: pick(a.limits, 'seven'), threads: a.threads ?? null, inUse: a.inUse })

async function load(): Promise<{ rows: Row[]; several: boolean }> {
  const r = await accountsList()
  if (r.ok) return { rows: r.data.map(fromAccount), several: true }
  const s = await window.api.getStatus().catch(() => null)
  if (!s?.account) return { rows: [], several: false }
  const five = s.five?.pct ?? pick(s.usage, 'five')
  const seven = s.seven?.pct ?? pick(s.usage, 'seven')
  return {
    rows: [{ id: 'current', name: s.account.split('@')[0], email: s.account, plan: s.plan, five: five == null ? null : Math.round(five), seven: seven == null ? null : Math.round(seven), threads: null, inUse: true }],
    several: false,
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

export function AccountSwitcher({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ rows: Row[]; several: boolean } | null>(null)
  const [sel, setSel] = useState(0)
  const [flow, setFlow] = useState<'off' | 'ask' | 'signing' | 'done' | 'failed'>('off')
  // after a switch: the new login, and how many threads move when their work ends
  const [moved, setMoved] = useState<{ account: string | null; closed: number; waiting: number } | null>(null)
  useEffect(() => window.api.onAccountSwitched(setMoved), [])
  const [email, setEmail] = useState('')
  const [out, setOut] = useState('')
  useEscape(() => {
    if (flow === 'signing') void window.api.accountCancel()
    onClose()
  })
  useFocusTrap(box)

  const refresh = useCallback(() => void load().then((s) => { setState(s); setSel((i) => (i === 0 ? Math.max(0, s.rows.findIndex((r) => r.inUse)) : i)) }), [])
  useEffect(() => { refresh(); return onAccountsChanged(refresh) }, [refresh])
  useEffect(() => window.api.onAccountOutput((t) => setOut((o) => o + t)), [])

  const rows = state?.rows ?? []
  const several = state?.several ?? false
  const tab = activeId()
  const other = rows.find((r) => !r.inUse)

  const switchTo = async (r: Row) => {
    if (r.inUse || !several) return
    const res = await accountUse(r.id)
    if (res.ok) { notice(`Switched to ${r.name}`); onClose() } else notice(`Could not switch: ${res.reason}`)
  }
  const move = async () => {
    if (!tab || !other) return
    const res = await threadAccount(tab, other.id)
    notice(res.ok ? `This thread moves to ${other.name}` : `Could not move the thread: ${res.reason}`)
    if (res.ok) onClose()
  }
  const add = async () => {
    const res = await accountAdd()
    if (res.ok) refresh(); else notice(`Could not add an account: ${res.reason}`)
  }
  const start = async () => {
    setFlow('signing'); setOut('')
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
    <div className="ovl-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="acct-pop" ref={box} role="dialog" aria-modal="true" aria-label="Accounts" tabIndex={-1} onKeyDown={keys} data-testid="account-switcher">
        <div className="poph">Accounts <span>Switching is instant. Running threads are not restarted.</span></div>
        {state && rows.length === 0 && <Unavailable reason="No signed-in account was found." />}
        {rows.map((r, i) => (
          <div
            key={r.id}
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
              <span>5h</span><span className="acct-bar"><Bar pct={r.five ?? 0} /><em className="acct-pct">{r.five == null ? '' : `${r.five}%`}</em></span>
              <span>7d</span><span className="acct-bar"><Bar pct={r.seven ?? 0} /><em className="acct-pct">{r.seven == null ? '' : `${r.seven}%`}</em></span>
            </div>
            <div className="acct-threads">{r.threads == null ? '' : `${r.threads} thread${r.threads === 1 ? '' : 's'}`}</div>
            <div className="acct-act">
              {r.inUse
                ? <State word="IN USE" tone="done" />
                : <button type="button" className="acct-keys" tabIndex={-1} onClick={() => void switchTo(r)} data-testid="account-use">Ctrl+Alt+{i + 1}</button>}
            </div>
          </div>
        ))}

        {state && !several && (
          <div className="acct-old">
            <div className="acct-dim">Several signed-in accounts need the main-process update. Until then, switching signs in again in the browser; nothing restarts, and every thread moves to the new login (a working one when its work ends).</div>
            {flow === 'off' && <Btn kind="plain" onClick={() => setFlow('ask')} testid="account-switch-old">Switch account</Btn>}
            {flow === 'ask' && (
              <div className="acct-flow">
                <input className="uline" autoFocus value={email} placeholder="Email to pre-fill (optional)" aria-label="Email" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void start() }} data-testid="account-email" />
                <Btn kind="primary" onClick={() => void start()}>Sign in</Btn>
              </div>
            )}
            {flow !== 'off' && flow !== 'ask' && (
              <>
                <pre className="log acct-log" data-testid="account-log">{out || (flow === 'signing' ? 'Finish signing in in the browser.' : '')}</pre>
                <div className="acct-flow">
                  {flow === 'signing' && <Btn kind="plain" onClick={cancel} testid="account-cancel">Cancel</Btn>}
                  {flow === 'done' && <span className="acct-dim" data-testid="account-done">{moved ? `Switched to ${moved.account ?? 'the new account'}${moved.waiting ? `; ${moved.waiting} thread${moved.waiting > 1 ? 's' : ''} move when ${moved.waiting > 1 ? 'they finish' : 'it finishes'}` : ''}.` : 'Signed in. Moving the threads to the new login.'}</span>}
                  {flow === 'failed' && <span className="acct-dim">The sign-in did not finish; nothing changed.</span>}
                </div>
              </>
            )}
          </div>
        )}

        <div className="acct-foot">
          <span>New threads use the account in use. A running thread keeps its account until you move it.</span>
          {several && <Btn kind="quiet" onClick={() => void add()} testid="account-add">Add account</Btn>}
          {several && tab && other && <Btn kind="quiet" onClick={() => void move()} testid="account-move">Move this thread to {other.name}</Btn>}
        </div>
      </div>
    </div>
  )
}
