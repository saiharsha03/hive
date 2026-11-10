// Switch the Claude account (from the account item in the status bar): a saved account at once, or Add account (the
// engine's browser sign-in, which is then saved too). Nothing restarts: quiet threads move to the new login at once,
// working ones when their work ends (main: account:switched). Tokens never reach the page: only emails and plans.
import { useEffect, useState } from 'react'
import { Modal } from './ui'

export function AccountSwitch({ current, working, onClose }: { current: string | null; working: number; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<'ask' | 'signing' | 'done' | 'failed'>('ask')
  const [out, setOut] = useState('')
  const [moved, setMoved] = useState<{ account: string | null; closed: number; waiting: number } | null>(null)
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof window.api.accountsList>>>([])
  const [said, setSaid] = useState<{ text: string; bad: boolean; signIn?: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  useEffect(() => window.api.onAccountOutput((t) => setOut((o) => o + t)), [])
  useEffect(() => window.api.onAccountSwitched(setMoved), [])
  useEffect(() => {
    const load = () => void window.api.accountsList().then(setSaved).catch(() => {})
    load()
    return window.api.onAccountsChanged(load)
  }, [])
  const switchTo = async (id: string, email: string) => {
    setBusyId(id); setSaid(null)
    const r = await window.api.accountsSwitch(id).catch((e) => ({ ok: false, error: String(e?.message ?? e), account: null, closed: 0, waiting: 0 } as Awaited<ReturnType<typeof window.api.accountsSwitch>>))
    setBusyId(null)
    if (r.ok) setSaid({ text: `Switched to ${r.account}${r.waiting ? `; ${r.waiting} thread${r.waiting > 1 ? 's' : ''} will move when ${r.waiting > 1 ? 'they finish' : 'it finishes'}` : ''}.${r.warning ? ` ${r.warning}` : ''}`, bad: false })
    else setSaid({ text: `${r.error ?? 'The switch did not finish.'}${r.warning ? ` ${r.warning}` : ''}`, bad: true, ...(r.needsSignIn ? { signIn: email } : {}) })
  }
  const forget = (id: string) => void window.api.accountsRemove(id).catch(() => {})
  const link = out.match(/https:\/\/\S+/)?.[0]

  const start = async () => {
    setPhase('signing'); setOut('')
    const r = await window.api.accountSwitch(email)
    setOut((o) => o || r.output)
    setPhase(r.ok ? 'done' : 'failed')
  }
  const close = () => { if (phase === 'signing') void window.api.accountCancel(); onClose() }

  return (
    <Modal title="Switch Claude account" onClose={close} testid="account-switch">
      {phase === 'ask' && saved.length > 0 && <>
        <p className="dnote">Saved accounts: switching takes a moment, with no browser.</p>
        {saved.map((a) => (
          <div key={a.id} className="drow" data-testid="account-row">
            <span className="wlab">{a.email}</span>
            <span className="dnote">{[a.organization, a.plan, a.active ? 'signed in' : a.lastUsed ? `last used ${new Date(a.lastUsed).toLocaleDateString()}` : ''].filter(Boolean).join(' · ')}</span>
            {!a.active && <button className="dbtn" disabled={!!busyId} onClick={() => void switchTo(a.id, a.email)} data-testid="account-use">{busyId === a.id ? 'Switching…' : 'Switch'}</button>}
            <button className="dlink" onClick={() => forget(a.id)} title="Forget this saved login (the account itself is not touched)">Remove</button>
          </div>
        ))}
        {said && <p className={said.bad ? 'derr' : 'dnote'} data-testid="account-said">{said.text}
          {said.signIn && <> <button className="dlink" onClick={() => { setEmail(said.signIn!); setSaid(null) }}>Sign in to {said.signIn} with the browser</button></>}</p>}
        <p className="dnote">Add account:</p>
      </>}
      {phase === 'ask' && <>
        <p className="dnote">Signed in as {current ?? 'unknown'}. Signing in with another account opens the browser; nothing restarts. Every thread moves to the new account, a working one when its work ends.</p>
        {working > 0 && <p className="dnote" data-testid="account-working">{working} thread{working > 1 ? 's are' : ' is'} working: {working > 1 ? 'they finish' : 'it finishes'} on the current account first.</p>}
        <div className="drow">
          <input className="sin wide" value={email} placeholder="Email to pre-fill (optional)" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void start() }} data-testid="account-email" autoFocus />
          <button className="dbtn primary" onClick={() => void start()} data-testid="account-signin">Sign in</button>
        </div>
      </>}
      {phase === 'signing' && <>
        <p className="dnote">Finish signing in in the browser.{link ? ' If it did not open:' : ''}</p>
        {link && <p><a href={link} target="_blank" rel="noreferrer" data-testid="account-link">{link}</a></p>}
        <button className="dlink" onClick={close} data-testid="account-cancel">Cancel</button>
      </>}
      {phase === 'done' && <p className="dnote" data-testid="account-done">{moved
        ? `Switched to ${moved.account ?? 'the new account'}${moved.waiting ? `; ${moved.waiting} thread${moved.waiting > 1 ? 's' : ''} will move to the new login when ${moved.waiting > 1 ? 'they finish' : 'it finishes'}` : ''}.`
        : 'Signed in. Moving the threads to the new login…'}</p>}
      {phase === 'failed' && <>
        <p className="derr">The sign-in did not finish; nothing changed.</p>
        <pre className="allowout" data-testid="account-output">{out}</pre>
      </>}
    </Modal>
  )
}
