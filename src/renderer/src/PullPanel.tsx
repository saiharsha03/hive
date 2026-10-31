import { useEffect, useState } from 'react'

type Row = { repo: string; result: string }
const tone = (r: string) => (r.startsWith('updated') ? 'ok' : r.startsWith('failed') ? 'bad' : r.startsWith('skipped') ? 'warn' : '')

// Pull latest: one row per repo; plain git, no Claude. "Check only" fetches and reports what the button would do.
export function PullPanel({ onClose }: { onClose?: () => void }) {
  const [cfg, setCfg] = useState<{ ok: boolean; message: string } | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.api.pullConfig().then((c) => {
      setCfg(c)
      if (c.ok) window.api.pullList().then((names) => setRows(names.map((repo) => ({ repo, result: '' })))).catch((e) => setErr(e.message))
    })
    return window.api.onPullRow((row) => setRows((all) => all.map((r) => (r.repo === row.repo ? row : r))))
  }, [])

  const go = (dry: boolean) => {
    setBusy(true); setErr('')
    setRows((all) => all.map((r) => ({ ...r, result: '' })))
    window.api.pullRun(dry).then((done) => setRows(done)).catch((e) => setErr(e.message)).finally(() => setBusy(false))
  }
  return (
    <section className="tool">
      <div className="dhead">
        <span className="dtitle"><span className="ph ph-pull">↓</span>Pull latest</span>
        <span className="dnote">Fetches every repo, then fast-forwards the default branch. Repos with uncommitted changes or unpushed commits are left alone.</span>
        <span className="dspace" />
        {onClose && <button className="dlink" aria-label="Close" onClick={onClose} data-testid="tool-close">×</button>}
      </div>
      <div className="dbody">
        {cfg && !cfg.ok && <div className="derr">{cfg.message}</div>}
        {cfg?.ok && (
          <>
            <div className="drow">
              <button data-testid="pull-button-1" className="dbtn primary" disabled={busy} onClick={() => go(false)}>{busy ? 'Working...' : 'Pull latest'}</button>
              <button data-testid="pull-button-2" className="dbtn" disabled={busy} onClick={() => go(true)}>Check only</button>
            </div>
            {err && <div className="derr">{err}</div>}
            <table className="dtable">
              <thead><tr><th>Repo</th><th>Result</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.repo}><td>{r.repo}</td><td className={`pr ${tone(r.result) || (busy ? 'work' : '')}`}>{r.result || (busy ? 'working...' : '')}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </div>
    </section>
  )
}
