// Deploys: the stages main, staging and prod, what will ship, the live run and its confirm step, and this session's
// history. Your deploy scripts do the work; every button here sends an action the wizard (shared/deployWizard) already has.
import { Fragment, useEffect, useRef, useState } from 'react'
import { Btn, ConfirmBar, Empty, PageHead, Section, State, clock, dur, when } from '../kit'
import { diagnose, openPage } from '../actions'
import { diagnosePrompt, stagingAheadOfProd, type DeployConfig } from '../../../shared/deployCore'
import { fmtDuration, summary, wizardBusy } from '../../../shared/deployWizard'
import type { useDeploy } from '../useDeploy'
import {
  canStop, commitsWord, fold, getHistory, logLines, matrixOf, recordHistory, resultWord, runState, shipRows, stagesOf, stepWord, tabState, targetOf, zoneOf,
} from './deploysCore'
import { deployMessage } from '../../../shared/deployMessage'
import './deploys.css'

type Deploy = ReturnType<typeof useDeploy>

// diffs.sh output as printed, with its URLs clickable
const Linked = ({ text }: { text: string }) => (
  <>{text.split(/(https:\/\/\S+)/).map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p))}</>
)

function AllRepos({ cfg }: { cfg: DeployConfig }) {
  const [rows, setRows] = useState<DeployEnvStatus[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const check = () => {
    setBusy(true); setErr('')
    window.api.deployStatus().then(setRows).catch((e: Error) => setErr(e.message)).finally(() => setBusy(false))
  }
  const m = rows ? matrixOf(cfg, rows) : null
  return (
    <Section title="All repos" note="Read-only: ECS images and S3 / live bundle versus the branch head.">
      <div className="dep-bar">
        <Btn testid="deploy-button-1" kind="plain" disabled={busy} onClick={check}>{busy ? 'Checking...' : 'Check status'}</Btn>
      </div>
      {err && <div className="dep-err" data-testid="deploy-status-error">{err}</div>}
      {m && (
        <table className="dt dep-matrix">
          <thead><tr><th>Repo</th>{m.envs.map((e) => <th key={e}>{e}</th>)}</tr></thead>
          <tbody>
            {m.lines.map((l) => (
              <tr key={l.repo}>
                <td className="strong">{l.repo}</td>
                {l.cells.map((c, i) => <td key={i}><State word={c.word} tone={c.tone} />{c.sha && <span className="mono dep-sha"> {c.sha}</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows && rows.length > 0 && (
        <div className="dep-notes">
          {rows.flatMap((r) => [['api', r.api] as const, ['web', r.web] as const].filter(([, c]) => c.detail).map(([k, c]) => <div key={`${r.env}-${k}`}>{r.env} {k}: {c.detail}</div>))}
        </div>
      )}
    </Section>
  )
}

export function DeploysPage({ deploy }: { deploy: Deploy }) {
  const { w, out, act, cfg } = deploy
  const dc = cfg?.config ?? null
  const [view, setView] = useState<'repo' | 'all'>('repo')
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [, bump] = useState(0)
  const hist = useRef<HTMLDivElement>(null)
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => { if (recordHistory(w)) bump((n) => n + 1) }, [w])
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [out])

  const zone = zoneOf(w)
  const target = targetOf(w)
  const stages = stagesOf(w, clock)
  const ship = shipRows(w, target)
  const { shown, more } = fold(ship.rows, open)
  const cur = w.steps[w.cur]
  const upcoming = w.phase === 'ask' && !w.toProd ? w.steps.find((s, i) => i > w.cur && s.status === 'pending') : undefined
  const rs = runState(w)
  const lines = logLines(out)
  const rows = summary(w)
  const started = w.steps.some((s) => s.startedAt)
  const history = getHistory()
  const stop = (id: string) => <Btn testid={id} kind="plain" onClick={() => act({ t: 'stop' })}>Stop</Btn>
  const pickable = w.phase === 'pick' || w.phase === 'done' || w.phase === 'stopped'

  const head = (
    <>
      {dc && (
        <>
          <Btn testid="deploy-button-2" kind="link" className={view === 'repo' ? 'dep-on' : ''} onClick={() => setView('repo')}>Repo</Btn>
          <Btn testid="deploy-button-3" kind="link" className={view === 'all' ? 'dep-on' : ''} onClick={() => setView('all')}>All repos</Btn>
        </>
      )}
      {dc && canStop(w) && <Btn testid="deploy-button-4" kind="link" disabled={wizardBusy(w)} onClick={() => act({ t: 'stop' })}>Stop</Btn>}
      <Btn kind="link" onClick={() => { setView('repo'); setTimeout(() => hist.current?.scrollIntoView({ block: 'start' }), 0) }}>History</Btn>
    </>
  )

  return (
    <div className="page" data-testid="page-deploys">
      <PageHead title="Deploys" desc="Your deploy scripts do the work. Hive shows what ships and checks it landed." right={<span className="dep-right">{head}</span>} />
      {!cfg && <Empty>Reading the deploy settings...</Empty>}
      {cfg && !dc && (
        <div data-testid="deploy-config-error" className="dep-cfg">
          <p>{cfg.message}</p>
          <Btn kind="plain" onClick={() => openPage('settings')}>Open Settings</Btn>
        </div>
      )}
      {dc && view === 'all' && <AllRepos cfg={dc} />}
      {dc && view === 'repo' && (
        <div data-testid="deploy-panel">
          <div className="page-tabs" role="tablist">
            {dc.suites.map((s) => {
              const st = tabState(w, s)
              const active = w.suite === s.id
              return (
                <button
                  key={s.id} data-testid="deploy-suite" role="tab" aria-selected={active} className={active ? 'on' : ''}
                  disabled={!pickable || (active && w.phase !== 'done' && w.phase !== 'stopped')}
                  title={[...s.api, ...s.web].join(', ')}
                  onClick={() => { if (w.phase !== 'pick') act({ t: 'reset' }); act({ t: 'pick', suite: s.id, groups: { api: s.api, web: s.web } }) }}
                >
                  {s.label}{st && <State word={st.word} tone={st.tone} />}
                </button>
              )
            })}
          </div>
          {w.error && zone === 'pick' && <div className="dep-err">{w.error}</div>}
          {zone === 'pick' && !dc.suites.length && <Empty>No suites are set up in the deploy settings.</Empty>}
          {zone === 'pick' && dc.suites.length > 0 && <Empty>Choose a repo above to read its git state.</Empty>}
          {zone === 'load' && <Empty>Reading git state...</Empty>}

          {stages && (
            <div className="dep-stages">
              {stages.stages.map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && <div className={`dep-arrow${stages.connectors[i - 1].on ? ' on' : ''}`}><span>{stages.connectors[i - 1].label}</span></div>}
                  <div className={`dep-stg dep-r-${s.rule}${s.on ? ' on' : ''}`} data-testid={`deploy-stage-${s.key}`}>
                    <div className="dep-sn">{s.name}</div>
                    <div className="dep-ss"><State word={s.state.word} tone={s.state.tone} />{s.sha && <span className="mono dep-sha"> {s.sha}</span>}</div>
                    <div className="dep-sd">{s.line}</div>
                  </div>
                </Fragment>
              ))}
            </div>
          )}

          {zone !== 'pick' && zone !== 'load' && (
            <div className="grid-even dep-cols">
              <Section title={target ? `Will ship to ${target}` : 'Shipped'} note={target ? commitsWord(ship.rows.length) : undefined}>
                {w.error && zone === 'review' && <div data-testid="deploy-diffs-error" className="dep-err">diffs.sh did not finish, still showing local refs: {w.error}</div>}
                {ship.errors.map((e) => <div key={e.repo} className="dep-err">{e.repo}: {e.error}</div>)}
                {ship.migrations.length > 0 && <div className="dep-row"><State word="migrations" tone="wait" /><span className="dep-dim"> in {ship.migrations.join(', ')}</span></div>}
                {target === 'staging' && w.diffs.some((d) => stagingAheadOfProd(d) > 0) && (
                  <div className="dep-dimline">Staging is already ahead of prod. Those commits ship with the next prod deploy.</div>
                )}
                {!ship.rows.length && !ship.errors.length && <Empty>{zone === 'end' ? 'Nothing is waiting.' : 'No commits to ship.'}</Empty>}
                {shown.map((c) => (
                  <div key={`${c.repo}-${c.sha}`} className="dep-commit">
                    <span className="mono dep-csha">{c.sha.slice(0, 7)}</span>
                    <span className="dep-ctitle">{c.title}</span>
                    <span className="dep-cau">{c.author}{c.pr ? ` #${c.pr}` : ''}</span>
                  </div>
                ))}
                {more > 0 && <Btn kind="quiet" onClick={() => setOpen(true)}>{more} more</Btn>}
                {open && ship.rows.length > 8 && <div><Btn kind="quiet" onClick={() => setOpen(false)}>Fold</Btn></div>}
              </Section>

              <Section title={target ? `${target} run` : 'Run'} note="Live output">
                {zone === 'review' && (
                  <>
                    <div className="dep-q">{w.output ? 'diffs.sh output' : 'Changelog message (from local refs)'}</div>
                    {w.note && <div className="dep-dimline">{w.note}</div>}
                    <pre data-testid="deploy-diffs" className="log dep-diffs"><Linked text={w.output ? w.output.replace(/\n+$/, '') : w.changelog} /></pre>
                    <ConfirmBar actions={<>
                      <Btn testid="deploy-copy" kind="quiet" onClick={() => { void navigator.clipboard.writeText(deployMessage(w.output || w.changelog)).then(() => setCopied(true)) }}>{copied ? 'Copied' : 'Copy message'}</Btn>
                      {stop('deploy-button-6')}<Btn testid="deploy-next" kind="primary" onClick={() => act({ t: 'next' })}>Team approved, next</Btn></>}>
                      {w.output ? 'Hive copied this message to your clipboard.' : 'Copy this message.'} Post it to the team, then continue once you have their approval.
                    </ConfirmBar>
                  </>
                )}

                {zone !== 'review' && w.steps.length > 0 && (
                  <table className="dt dep-steps">
                    <thead><tr><th>Target</th><th>Repo</th><th className="num">Commits</th><th>State</th></tr></thead>
                    <tbody>
                      {w.steps.map((s, i) => {
                        const sw = stepWord(s, i === w.cur && (w.phase === 'deploying' || w.phase === 'watching' || w.phase === 'manual'))
                        return <tr key={`${s.env}-${s.repo}`}><td>{s.env}</td><td className="strong">{s.repo}</td><td className="num">{s.commits.length}</td><td><State word={sw.word} tone={sw.tone} />{s.sha && <span className="mono dep-sha"> {s.sha.slice(0, 7)}</span>}</td></tr>
                      })}
                    </tbody>
                  </table>
                )}

                {rs && zone === 'run' && <div className="dep-row"><State word={rs.word.word} tone={rs.word.tone} /><span className={rs.word.tone === 'fail' ? 'dep-failt' : 'dep-dim'}> {rs.text}</span></div>}
                {(zone === 'run' || lines.length > 0) && zone !== 'review' && (
                  <div className="log dep-log" data-testid="deploy-output" ref={log}>
                    {lines.length ? lines.map((l, i) => <div key={i}>{l.t && <span className="tt">{l.t}</span>}{l.text}</div>) : <span className="dep-dim">Waiting for output.</span>}
                  </div>
                )}

                {zone === 'ask' && (
                  <>
                    {upcoming && upcoming.commits.length > 0 && <div className="dep-dimline">{upcoming.repo}: {commitsWord(upcoming.commits.length)}</div>}
                    <ConfirmBar testid="deploy-ask" actions={<>{stop('deploy-button-7')}<Btn testid="deploy-yes" kind="primary" onClick={() => act({ t: 'yes', at: Date.now() })}>Promote now</Btn></>}>
                      {w.question}
                    </ConfirmBar>
                  </>
                )}

                {w.phase === 'stuck' && cur && (
                  <ConfirmBar actions={<>
                    {stop('deploy-button-10')}
                    <Btn testid="deploy-button-9" kind="plain" onClick={() => act({ t: 'retry', at: Date.now() })}>Retry the check</Btn>
                    <Btn testid="deploy-button-8" kind="primary" onClick={() => diagnose(diagnosePrompt(cur.repo, cur.env, w.note), w.root)}>Diagnose</Btn>
                  </>}>
                    {cur.repo} to {cur.env} has not been seen live. Retry the landed check, or have Claude find out why.
                  </ConfirmBar>
                )}
                {w.phase === 'manual' && (
                  <ConfirmBar actions={<>{stop('deploy-button-12')}<Btn testid="deploy-button-11" kind="primary" onClick={() => act({ t: 'confirmManual', at: Date.now() })}>Looks good, continue</Btn></>}>
                    {w.question}
                  </ConfirmBar>
                )}
                {w.phase === 'failed' && (
                  <ConfirmBar actions={<>{stop('deploy-button-14')}<Btn testid="deploy-button-13" kind="primary" onClick={() => act({ t: 'retry', at: Date.now() })}>{w.toProd ? 'Back' : 'Try again'}</Btn></>}>
                    {cur ? `${cur.repo} to ${cur.env} did not go out.` : 'The deploy did not start.'}
                  </ConfirmBar>
                )}

                {zone === 'end' && (
                  <>
                    <div data-testid="deploy-done" className="dep-q">{w.phase === 'done' ? 'Done' : 'Stopped'}{w.phase === 'stopped' && started ? ' (anything already pushed stays pushed)' : ''}</div>
                    {rows.length > 0
                      ? <table className="dt"><thead><tr><th>Repo</th><th>Target</th><th>Commit</th><th>State</th><th className="num">Took</th></tr></thead>
                        <tbody>{rows.map((s) => <tr key={`${s.env}-${s.repo}`}><td className="strong">{s.repo}</td><td>{s.env}</td><td className="mono">{s.sha}</td><td>{s.status}</td><td className="num">{fmtDuration(s.ms)}</td></tr>)}</tbody></table>
                      : <Empty>Nothing was pushed.</Empty>}
                    <div className="dep-bar"><Btn testid="deploy-button-15" kind="plain" onClick={() => act({ t: 'reset' })}>New deploy</Btn></div>
                  </>
                )}
              </Section>
            </div>
          )}

          <div ref={hist}>
            <Section title="History" note="This session" testid="deploy-history">
              {!history.length
                ? <Empty>Nothing has been deployed from Hive since it opened.</Empty>
                : (
                  <table className="dt">
                    <thead><tr><th>When</th><th>Repo</th><th>Target</th><th>Commit</th><th>Result</th><th className="num">Took</th><th>Landed</th></tr></thead>
                    <tbody>
                      {history.map((h) => {
                        const r = resultWord(h.result)
                        return (
                          <tr key={h.key} className={h.result === 'failed' ? 'fail' : ''}>
                            <td className="num">{when(h.at)}</td><td className="strong">{h.repo}</td><td>{h.target}</td><td className="mono">{h.sha.slice(0, 7)}</td>
                            <td><State word={r.word} tone={r.tone} /></td>
                            <td className="num">{h.tookMs !== null ? dur(h.tookMs) : ''}</td>
                            <td>{h.landedAt ? <span className="dep-landed">{clock(h.landedAt)}</span> : <span className="dep-failt">{h.reason}</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}
