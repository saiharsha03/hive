// Switch the Claude account (from the account item in the status bar): the engine's browser sign-in. Nothing restarts:
// quiet threads move to the new login at once, working ones when their work ends (main: account:switched).
import { useEffect, useState } from 'react'
import { Modal } from './ui'

export function AccountSwitch({ current, working, onClose }: { current: string | null; working: number; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<'ask' | 'signing' | 'done' | 'failed'>('ask')
  const [out, setOut] = useState('')
  const [moved, setMoved] = useState<{ account: string | null; closed: number; waiting: number } | null>(null)
  useEffect(() => window.api.onAccountOutput((t) => setOut((o) => o + t)), [])
  useEffect(() => window.api.onAccountSwitched(setMoved), [])
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
