import { useEffect, useRef, useState } from 'react'
import { elapsed, type ScriptRun, type ScriptView } from '../../shared/scriptsCore'

type Props = { runs: ScriptRun[]; onClose?: () => void; onOpen: (path: string) => void }
type Cfg = { scripts: ScriptView[]; message: string; path: string }

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const dot = (r: ScriptRun) => (r.phase === 'running' ? 'ldot work' : r.phase === 'ok' ? 'dot ok' : r.phase === 'failed' ? 'dot bad' : 'dot')
const state = (r: ScriptRun) => (r.phase === 'ok' ? 'pass' : r.phase === 'failed' ? 'fail' : r.phase)

function Card({ s, run, onOpen }: { s: ScriptView; run?: ScriptRun; onOpen: (path: string) => void }) {
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  const pre = useRef<HTMLPreElement>(null)
  const running = run?.phase === 'running'
  const show = !!run && (open || running)
  useEffect(() => { if (show && pre.current) pre.current.scrollTop = pre.current.scrollHeight }, [run?.output, show])
  // the elapsed time counts up while it runs
  useEffect(() => { if (!running) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [running])

  const start = (label: string) => { setErr(''); setOpen(false); window.api.scriptsRun(s.name, label).catch((e) => setErr(clean(e))) }
  return (
    <div data-testid="script-card" className="ckstep">
      <div className="drow">
        <span className="dq">{s.name}</span>
        <span className="dnote">{s.cwd}</span>
        <span className="dspace" />
        {running && <button data-testid="scripts-button-1" className="dlink" onClick={() => void window.api.scriptsStop(s.name)}>Stop</button>}
      </div>
      {s.missing && <div className="derr">{s.missing}</div>}
      <div className="drow">
        {s.options.map((o, i) => (
          <button data-testid="script-run" key={o.label} className={`dbtn${i === 0 ? ' primary' : ''}`} title={o.cmd} disabled={running || !!s.missing || !!o.missing} onClick={() => start(o.label)}>{o.label}</button>
        ))}
      </div>
      {s.options.filter((o) => o.missing).map((o) => <div key={o.label} className="derr">{o.label}: {o.missing}</div>)}
      {err && <div className="derr">{err}</div>}
      {run && (
        <div className="ckrow">
          <span className={dot(run)} />
          <span className="ckl">{run.label}</span>
          <span data-testid="script-state" className={`ckst ${state(run)}`}>{running ? 'running' : run.phase}</span>
          <span className="dnote">{run.note}</span>
          <span className="dspace" />
          <span className="dnote">{elapsed((run.endedAt ?? Date.now()) - run.startedAt)}</span>
          {run.opened && <button data-testid="scripts-button-2" className="dlink" title={run.opened} onClick={() => onOpen(run.opened!)}>Open report</button>}
          <button data-testid="scripts-button-3" className="dlink" title={run.log} onClick={() => void window.api.openExternal(run.log)}>Log</button>
          {!running && <button data-testid="script-output-toggle" className="dlink" onClick={() => setOpen((o) => !o)}>{open ? 'Hide output' : 'Output'}</button>}
        </div>
      )}
      {show && run.output && <pre data-testid="script-output" className="dout" ref={pre}>{run.output}</pre>}
    </div>
  )
}

// Scripts: one card per entry in the local scripts.json; each button runs a plain command, no Claude
export function ScriptsPanel({ runs, onClose, onOpen }: Props) {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [err, setErr] = useState('')
  const reload = () => { setErr(''); window.api.scriptsConfig().then(setCfg).catch((e) => setErr(clean(e))) }
  useEffect(reload, [])
  return (
    <section data-testid="scripts-panel" className="tool">
      <div className="dhead">
        <span className="dtitle"><span className="ph ph-scripts">▶</span>Scripts</span>
        <span className="dnote">Runs a command from scripts.json in its folder and shows the output. The last 400 lines show here; the log has all of it.</span>
        <span className="dspace" />
        <button data-testid="scripts-button-4" className="dlink" onClick={reload}>Reload</button>
        {onClose && <button className="dlink" aria-label="Close" onClick={onClose} data-testid="tool-close">×</button>}
      </div>
      <div className="dbody">
        {cfg?.message && <div className="derr">{cfg.message}</div>}
        {err && <div className="derr">{err}</div>}
        {cfg?.scripts.map((s) => <Card key={s.name} s={s} run={runs.find((r) => r.name === s.name)} onOpen={onOpen} />)}
      </div>
    </section>
  )
}
