import { useEffect, useRef, useState } from 'react'
import type { DevService, DevState, Source, SourceOption } from '../../shared/devCore'

type Props = { state: DevState | null; setState: (s: DevState) => void; onClose?: () => void }
const STATE_CLASS: Record<string, string> = { running: 'ok', starting: 'work', failed: 'bad', stopped: '' }
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()

export function DevPanel({ state, setState, onClose }: Props) {
  const [opts, setOpts] = useState<Record<string, SourceOption[]>>({})
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [logFor, setLogFor] = useState<string | null>(null)
  const [logText, setLogText] = useState('')
  const pre = useRef<HTMLPreElement>(null)
  const ok = !!state?.configured

  // fresh ports / docker state while the panel is open
  useEffect(() => {
    if (!ok) return
    const tick = () => window.api.devState().then(setState).catch(() => {})
    tick()
    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [ok])
  const repos = [...new Set((state?.services ?? []).filter((s) => s.kind === 'process').map((s) => s.repo))].join('|')
  const loadSources = () => repos.split('|').filter(Boolean).forEach((r) =>
    window.api.devSources(r).then((o) => setOpts((all) => ({ ...all, [r]: o }))).catch(() => {}))
  useEffect(loadSources, [repos])
  useEffect(() => {
    if (!logFor) return
    const get = () => window.api.devLogs(logFor).then(setLogText).catch((e) => setLogText(e.message))
    get()
    const t = setInterval(get, 1500)
    return () => clearInterval(t)
  }, [logFor])
  useEffect(() => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight }, [logText])

  const sourceOf = (repo: string, value: string): Source => opts[repo]?.find((o) => o.value === value)?.source ?? { kind: 'main' }
  // what the picker shows: the folder a running service came from, else the choice made for the next start
  const valueOf = (s: DevService) => {
    const running = s.fromDir && opts[s.repo]?.find((o) => o.path && norm(o.path) === norm(s.fromDir!))
    return running ? running.value : choice[s.repo] ?? 'main'
  }
  const act = (fn: () => Promise<string | string[]>) => {
    setBusy(true); setMsg('')
    fn().then((r) => setMsg(Array.isArray(r) ? r.join('\n') : r)).catch((e) => setMsg(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => { setBusy(false); loadSources(); window.api.devState().then(setState).catch(() => {}) })
  }
  const sourcesFor = (ids: string[]) => {
    const out: Record<string, Source> = {}
    for (const s of state?.services ?? []) if (ids.includes(s.name) && s.kind === 'process') out[s.repo] = sourceOf(s.repo, choice[s.repo] ?? 'main')
    return out
  }
  const pick = (s: DevService, value: string) => {
    setChoice((c) => ({ ...c, [s.repo]: value }))
    // switching restarts only this service from the new folder
    if (s.state === 'starting' || (s.state === 'running' && !s.external)) act(() => window.api.devStart(s.name, sourceOf(s.repo, value)))
  }

  return (
    <section className="tool">
      <div className="dhead">
        <span className="dtitle"><span className="ph ph-dev">◆</span>Dev stack</span>
        {state?.docker.phase === 'starting' && <span className="dnote"><span className="ldot work" />{state.docker.message}</span>}
        <span className="dspace" />
        {onClose && <button className="dlink" aria-label="Close" onClick={onClose} data-testid="tool-close">×</button>}
      </div>
      <div className="dbody">
        {!ok && <div className="derr">{state?.message ?? 'Loading...'}</div>}
        {ok && (
          <>
            {state!.message && <div className="dwarn">{state!.message}</div>}
            {state!.docker.phase === 'error' && <div className="derr">{state!.docker.message}</div>}
            <div className="drow">
              {state!.stacks.map((st) => (
                <button data-testid="dev-button-1" key={st.id} className="dbtn primary" disabled={busy} onClick={() => act(() => window.api.devStack(st.id, sourcesFor(st.services)))}>Start {st.label}</button>
              ))}
              <button data-testid="dev-button-2" className="dbtn" disabled={busy} onClick={() => act(() => window.api.devStopAll())}>Stop all</button>
              <span className="dnote">Databases are shared; Run from only changes the local servers.</span>
            </div>
            {msg && <pre className="dmsg">{msg}</pre>}
            {state!.stacks.length === 0 && <div className="dnote">No stacks are defined in .env (HIVE_STACKS).</div>}
            <table className="dtable">
              <thead><tr><th>Service</th><th>Status</th><th>Port</th><th>Run from</th><th>Started by</th><th /></tr></thead>
              <tbody>
                {state!.services.map((s) => {
                  const live = s.state === 'starting' || s.state === 'running'
                  return (
                    <tr key={s.name}>
                      <td>{s.label}</td>
                      <td><span className={`pr ${STATE_CLASS[s.state]}`}>{s.state}</span>{s.note && <div className="dd">{s.note}</div>}</td>
                      <td>{s.port ?? ''}</td>
                      <td>
                        {s.kind === 'process'
                          ? <select data-testid="dev-select-3" className="dsel" value={valueOf(s)} disabled={busy || s.external} onChange={(e) => pick(s, e.target.value)}>
                              {(opts[s.repo] ?? [{ value: 'main', label: 'main checkout' } as SourceOption]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          : <span className="dnote">main checkout</span>}
                      </td>
                      <td>{s.owner}</td>
                      <td className="dact">
                        {s.open && s.state === 'running' && s.port && <a className="dlink" href={`http://localhost:${s.port}`} target="_blank" rel="noreferrer">Open</a>}
                        <button data-testid="dev-button-4" className="dlink" onClick={() => setLogFor(logFor === s.name ? null : s.name)}>{logFor === s.name ? 'Hide logs' : 'Logs'}</button>
                        {s.kind === 'process' && live && !s.external && <button data-testid="dev-button-5" className="dlink" disabled={busy} onClick={() => act(() => window.api.devStop(s.name))}>Stop</button>}
                        {s.kind === 'docker' && s.state === 'running' && <button data-testid="dev-button-6" className="dlink" disabled={busy} onClick={() => act(() => window.api.devStop(s.name))}>Stop</button>}
                        {!live && <button data-testid="dev-button-7" className="dlink" disabled={busy} onClick={() => act(() => window.api.devStart(s.name, sourceOf(s.repo, choice[s.repo] ?? 'main')))}>Start</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {logFor && <pre className="dout" ref={pre}>{logText || '(no output yet)'}</pre>}
          </>
        )}
      </div>
    </section>
  )
}
