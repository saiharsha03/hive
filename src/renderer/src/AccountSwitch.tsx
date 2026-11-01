// Switch the Claude account (from the account item in the status bar): the engine's browser sign-in, then the app
// restarts so every thread runs on the new login. Threads that are working lose their current turn.
import { useEffect, useState } from 'react'
import { Modal } from './ui'

export function AccountSwitch({ current, working, onClose }: { current: string | null; working: number; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<'ask' | 'signing' | 'done' | 'failed'>('ask')
  const [out, setOut] = useState('')
  useEffect(() => window.api.onAccountOutput((t) => setOut((o) => o + t)), [])
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
        <p className="dnote">Signed in as {current ?? 'unknown'}. Signing in with another account opens the browser; when it finishes, the app restarts so every thread uses the new account.</p>
        {working > 0 && <p className="derr" data-testid="account-working">{working} thread{working > 1 ? 's are' : ' is'} working: the restart stops {working > 1 ? 'their' : 'its'} current turn.</p>}
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
      {phase === 'done' && <p className="dnote" data-testid="account-done">Signed in. Restarting…</p>}
      {phase === 'failed' && <>
        <p className="derr">The sign-in did not finish; nothing changed.</p>
        <pre className="allowout" data-testid="account-output">{out}</pre>
      </>}
    </Modal>
  )
}
