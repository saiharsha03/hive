import { useEffect, useRef, useState } from 'react'
import { diagnosePrompt, stagingAheadOfProd, type Commit, type DeployConfig, type RepoDiff } from '../../shared/deployCore'
import { fmtDuration, summary, wizardBusy, type Action, type Wizard } from '../../shared/deployWizard'

type Props = {
  cfg: { config: DeployConfig | null; message: string } | null
  w: Wizard
  out: string
  act: (a: Action) => void
  onDiagnose: (prompt: string, cwd: string) => void
}

const CommitList = ({ commits }: { commits: Commit[] }) => (
  <div className="dcommits">
    {commits.map((c) => (
      <div key={c.sha} className="dc">
        <span className="sha">{c.sha}</span>
        <span className="ti">{c.title}</span>
        <span className="au">{c.author}{c.pr ? ` #${c.pr}` : ''}</span>
      </div>
    ))}
  </div>
)

// diffs.sh output as printed, with its URLs clickable
const Linked = ({ text }: { text: string }) => (
  <>{text.split(/(https:\/\/\S+)/).map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p))}</>
)

const plural = (n: number) => `${n} commit${n === 1 ? '' : 's'}`

function RepoDiffView({ d }: { d: RepoDiff }) {
  if (d.error) return <div className="drepo"><div className="dh">{d.repo}</div><div className="derr">{d.error}</div></div>
  return (
    <div className="drepo">
      <div className="dh">{d.repo}{d.migrations ? <span className="dtag">contains migrations</span> : null}</div>
      <div className="dsub">main to staging: {plural(d.toStaging.length)}</div>
      {d.toStaging.length > 0 && <CommitList commits={d.toStaging} />}
      <div className="dsub">staging to prod: {plural(d.toProd.length)}</div>
      {stagingAheadOfProd(d) > 0 && <div className="dwarn">Staging is ahead of prod: {stagingAheadOfProd(d)} commit(s) were deployed to staging but never to prod. They ship with the next prod deploy.</div>}
      {d.toProd.length > 0 && <CommitList commits={d.toProd} />}
    </div>
  )
}

function Status({ cfg }: { cfg: DeployConfig }) {
  const [rows, setRows] = useState<DeployEnvStatus[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const check = () => {
    setBusy(true); setErr('')
    window.api.deployStatus().then(setRows).catch((e) => setErr(e.message)).finally(() => setBusy(false))
  }
  const show = (c: DeployEnvStatus['api']) =>
    c.verdict === 'current' ? `${c.served?.slice(0, 7)} (at head)` : c.verdict === 'behind' ? `${c.served?.slice(0, 7)} (${c.behind} behind ${c.head.slice(0, 7)})` : `unknown${c.note ? ` - ${c.note}` : ''}`
  return (
    <div className="dbody">
      <div className="drow"><button data-testid="deploy-button-1" className="dbtn" disabled={busy} onClick={check}>{busy ? 'Checking...' : 'Check status'}</button><span className="dnote">Read-only: ECS images and S3 / live bundle versus the branch head.</span></div>
      {err && <div className="derr">{err}</div>}
      {rows && (
        <table className="dtable">
          <thead><tr><th>Env</th><th>{cfg.apiRepo}</th><th>{cfg.webRepo}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.env}>
                <td>{r.env}</td>
                <td><div className={`v ${r.api.verdict}`}>{show(r.api)}</div><div className="dd">{r.api.detail}</div></td>
                <td><div className={`v ${r.web.verdict}`}>{show(r.web)}</div><div className="dd">{r.web.detail}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Steps({ w }: { w: Wizard }) {
  const tag = (s: Wizard['steps'][number], i: number) =>
    s.status === 'skipped' ? 'skipped (nothing to deploy)' : s.status === 'landed' ? `landed ${s.sha?.slice(0, 7)}` : s.status === 'confirmed' ? `pushed ${s.sha?.slice(0, 7)}, confirmed` : s.status === 'pushed' ? `pushed ${s.sha?.slice(0, 7)}` : i === w.cur ? 'in progress' : 'pending'
  return (
    <div className="dsteps">
      {w.steps.map((s, i) => (
        <div key={`${s.env}-${s.repo}`} className={`dstep ${s.status}${i === w.cur && s.status === 'pending' ? ' cur' : ''}`}><span>{s.env}</span><span>{s.repo}</span><span>{plural(s.commits.length)}</span><span className="st">{tag(s, i)}</span></div>
      ))}
    </div>
  )
}

export function DeployPanel({ cfg, w, out, act, onDiagnose }: Props) {
  const dc = cfg?.config ?? null
  const [tab, setTab] = useState<'deploy' | 'status'>('deploy')
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight }, [out])
  const cur = w.steps[w.cur]
  const upcoming = w.phase === 'ask' && !w.toProd ? w.steps.find((s, i) => i > w.cur && s.status === 'pending') : undefined
  const started = w.steps.some((s) => s.startedAt)
  const rows = summary(w)

  return (
    <section data-testid="deploy-panel" className="tool">
      <div className="dhead">
        <span className="dtitle"><span className="ph ph-deploy">▲</span>Deploy{w.suite ? ` - ${w.suite}` : ''}</span>
        <div className="seg">
          <button data-testid="deploy-button-2" className={tab === 'deploy' ? 'on' : ''} onClick={() => setTab('deploy')}>Deploy</button>
          <button data-testid="deploy-button-3" className={tab === 'status' ? 'on' : ''} onClick={() => setTab('status')}>Check status</button>
        </div>
        <span className="dspace" />
        {w.phase !== 'pick' && w.phase !== 'done' && w.phase !== 'stopped' && <button data-testid="deploy-button-4" className="dlink" onClick={() => act({ t: 'stop' })} disabled={wizardBusy(w)}>Stop</button>}
      </div>
      {cfg && !dc && <div data-testid="deploy-config-error" className="dbody"><div className="derr">{cfg.message}</div></div>}
      {dc && tab === 'status' && <Status cfg={dc} />}
      {dc && tab === 'deploy' && (
        <div className="dbody">
          {w.phase === 'pick' && (
            <div>
              <div className="dq">Which suite are you deploying?</div>
              <div className="drow">
                {dc.suites.map((s) => (
                  <button data-testid="deploy-suite" key={s.id} className="dbtn" onClick={() => act({ t: 'pick', suite: s.id, groups: { api: s.api, web: s.web } })}>{s.label}<span className="dnote"> {[...s.api, ...s.web].join(', ')}</span></button>
                ))}
              </div>
              {w.error && <div className="derr">{w.error}</div>}
            </div>
          )}
          {w.phase === 'loading' && <div className="dnote">Reading git state...</div>}
          {w.phase === 'review' && (
            <div>
              {w.note && <div className="dnote"><span className="ldot work" />{w.note}</div>}
              {w.error && <div data-testid="deploy-diffs-error" className="derr">diffs.sh did not finish, still showing local refs: {w.error}</div>}
              <div className="dq">{w.output ? 'diffs.sh output' : 'Changelog message (from local refs)'}</div>
              <pre data-testid="deploy-diffs" className="dmsg"><Linked text={w.output ? w.output.replace(/\n+$/, '') : w.changelog} /></pre>
              <div className="drow">
                <span className="dnote">diffs.sh already copied this to your clipboard. Post it to the team, then press Next once you have their approval.</span>
              </div>
              {w.diffs.map((d) => <RepoDiffView key={d.repo} d={d} />)}
              <div className="drow"><button data-testid="deploy-next" className="dbtn primary" onClick={() => act({ t: 'next' })}>Next</button><button data-testid="deploy-button-6" className="dbtn" onClick={() => act({ t: 'stop' })}>Stop</button></div>
            </div>
          )}
          {w.phase !== 'pick' && w.phase !== 'loading' && w.phase !== 'review' && (
            <div>
              <Steps w={w} />
              {w.phase === 'ask' && (
                <div className="dask">
                  <div className="dq">{w.question}</div>
                  {upcoming && <CommitList commits={upcoming.commits} />}
                  <div className="drow"><button data-testid="deploy-yes" className="dbtn primary" onClick={() => act({ t: 'yes', at: Date.now() })}>Yes</button><button data-testid="deploy-button-7" className="dbtn" onClick={() => act({ t: 'stop' })}>Stop</button></div>
                </div>
              )}
              {(w.phase === 'deploying' || w.phase === 'watching' || w.phase === 'stuck' || w.phase === 'manual' || w.phase === 'failed') && cur && (
                <div className="dask">
                  <div className="dq">{cur.repo} to {cur.env}{w.phase === 'deploying' ? ': pushing' : ''}</div>
                  {w.phase === 'watching' && <div className="dnote"><span className="ldot work" />{w.note}</div>}
                  {w.phase === 'stuck' && (
                    <>
                      <div className="derr">{w.note}</div>
                      <div className="drow">
                        <button data-testid="deploy-button-8" className="dbtn primary" onClick={() => onDiagnose(diagnosePrompt(cur.repo, cur.env, w.note), w.root)}>Diagnose</button>
                        <button data-testid="deploy-button-9" className="dbtn" onClick={() => act({ t: 'retry', at: Date.now() })}>Retry the check</button>
                        <button data-testid="deploy-button-10" className="dbtn" onClick={() => act({ t: 'stop' })}>Stop</button>
                      </div>
                    </>
                  )}
                  {w.phase === 'manual' && (
                    <>
                      <div className="dnote">{w.question}</div>
                      <div className="drow"><button data-testid="deploy-button-11" className="dbtn primary" onClick={() => act({ t: 'confirmManual', at: Date.now() })}>Looks good, continue</button><button data-testid="deploy-button-12" className="dbtn" onClick={() => act({ t: 'stop' })}>Stop</button></div>
                    </>
                  )}
                  {w.phase === 'failed' && (
                    <>
                      <div className="derr">{w.error}</div>
                      <div className="drow"><button data-testid="deploy-button-13" className="dbtn" onClick={() => act({ t: 'retry', at: Date.now() })}>{w.toProd ? 'Back' : 'Try again'}</button><button data-testid="deploy-button-14" className="dbtn" onClick={() => act({ t: 'stop' })}>Stop</button></div>
                    </>
                  )}
                  {out && <pre data-testid="deploy-output" className="dout" ref={pre}>{out}</pre>}
                </div>
              )}
              {(w.phase === 'done' || w.phase === 'stopped') && (
                <div className="dask">
                  <div data-testid="deploy-done" className="dq">{w.phase === 'done' ? 'Done' : 'Stopped'}{w.phase === 'stopped' && started ? ' (anything already pushed stays pushed)' : ''}</div>
                  {rows.length > 0 ? (
                    <table className="dtable">
                      <thead><tr><th>Repo</th><th>Env</th><th>Sha</th><th>State</th><th>Took</th></tr></thead>
                      <tbody>{rows.map((s) => <tr key={`${s.env}-${s.repo}`}><td>{s.repo}</td><td>{s.env}</td><td>{s.sha}</td><td>{s.status}</td><td>{fmtDuration(s.ms)}</td></tr>)}</tbody>
                    </table>
                  ) : <div className="dnote">Nothing was pushed.</div>}
                  <div className="drow"><button data-testid="deploy-button-15" className="dbtn" onClick={() => act({ t: 'reset' })}>New deploy</button></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
