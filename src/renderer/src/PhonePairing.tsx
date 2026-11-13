// Settings > General > Phone app: the link's state, Pair a phone (a QR code the app scans once: relay address, pair id,
// the phone's token and the sealing key), Unpair, and a test notification. The QR code is shown only until closed.
import { useEffect, useState } from 'react'

type Status = { configured: boolean; paired: boolean; connected: boolean; error: string }

export function PhonePairing() {
  const [st, setSt] = useState<Status | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void window.api.mobileStatus().then(setSt); return window.api.onMobileStatus(setSt) }, [])

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setMsg('')
    try { await f() } catch (e) { setMsg(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    setBusy(false)
  }
  const pair = () => run(async () => { setQr((await window.api.mobilePair()).image) })
  const unpair = () => run(async () => { await window.api.mobileUnpair(); setQr(null) })
  const test = () => run(async () => setMsg(await window.api.mobileTest()))

  const state = !st ? '' : !st.configured ? 'Set the relay address and admin token above, then save.' : !st.paired ? 'No phone paired.'
    : st.connected ? 'Phone paired; connected to the relay.' : `Phone paired; not connected to the relay${st.error ? ` (${st.error})` : ''}.`
  return (
    <div className="phonepair" data-testid="phone-pairing">
      <div className="dnote" data-testid="phone-state">{state}</div>
      <div className="drow">
        <button className="dbtn primary" disabled={busy || !st?.configured} onClick={() => void pair()} data-testid="phone-pair">{st?.paired ? 'Pair a new phone' : 'Pair a phone'}</button>
        {st?.paired && <button className="dlink" disabled={busy} onClick={() => void test()} data-testid="phone-test">Send a test notification</button>}
        {st?.paired && <button className="dlink" disabled={busy} onClick={() => void unpair()} data-testid="phone-unpair">Unpair</button>}
      </div>
      {qr && (
        <div className="phoneqr">
          <img src={qr} alt="Pairing code" width={240} height={240} data-testid="phone-qr" />
          <div className="dnote">Scan with the Orbit app on your phone. This code holds the key to the link: close it once the phone is paired, and pair again if anyone else saw it.</div>
          <button className="dlink" onClick={() => setQr(null)} data-testid="phone-qr-close">Close the code</button>
        </div>
      )}
      {msg && <div className="dnote" data-testid="phone-msg">{msg}</div>}
    </div>
  )
}
