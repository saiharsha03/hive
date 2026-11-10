// Stacks: one section per stack from Hive's .env (HIVE_STACKS). Start brings up the whole stack (Docker Desktop is
// opened first when it is not running), each repo runs from the branch / worktree picked in its row, and Shut down
// stops the stack's services except the ones another running stack still needs.
import { useEffect, useRef, useState } from 'react'
import type { DevService, DevState, Source, SourceOption, StackDef } from '../../shared/devCore'
import { State, type Tone } from './kit'

// onLogs: show a service's log somewhere else (the drawer); without it the log opens under the stacks
type Props = { state: DevState | null; setState: (s: DevState) => void; onClose?: () => void; onLogs?: (name: string) => void }
const STATE_TONE: Record<string, Tone> = { running: 'done', starting: 'wait', failed: 'fail', stopped: 'idle' }
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const isLive = (s: DevService) => s.state === 'starting' || s.state === 'running'

// what Shut down stops: the stack's live services (not ones run outside Hive), minus any service another stack
// still uses because that stack has a live service of its own, even one run outside Hive (core_api stays up for a
// running Admin stack)
export function shutdownNames(st: StackDef, stacks: StackDef[], services: DevService[]): string[] {
  const live = new Set(services.filter(isLive).map((s) => s.name))
  const ours = new Set(services.filter((s) => isLive(s) && !s.external).map((s) => s.name))
  const keptByOther = (n: string) => stacks.some((o) => o.id !== st.id && o.services.includes(n) && o.services.some((m) => live.has(m) && !st.services.includes(m)))
  return st.services.filter((n) => ours.has(n) && !keptByOther(n))
}

// what Start brings up: only the stack's services that are not running, so a service another thread runs from its
// worktree is never restarted onto another folder
export const startNames = (st: StackDef, services: DevService[]): string[] =>
  st.services.filter((n) => { const s = services.find((x) => x.name === n); return !!s && !isLive(s) })

export function DevPanel({ state, setState, onClose, onLogs }: Props) {
  const [opts, setOpts] = useState<Record<string, SourceOption[]>>({})
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [logFor, setLogFor] = useState<string | null>(null)
  const [logText, setLogText] = useState('')
  const pre = useRef<HTMLPreElement>(null)
  const ok = !!state?.configured

  // fresh ports / docker state while the tab is open
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
  const act = (key: string, fn: () => Promise<string | string[]>) => {
    setBusy(key); setMsg('')
    fn().then((r) => setMsg(Array.isArray(r) ? r.join('\n') : r)).catch((e) => setMsg(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => { setBusy(null); loadSources(); window.api.devState().then(setState).catch(() => {}) })
  }
  // the services Start brings up run from their row's pick (running ones are left alone, see startNames)
  const sourcesFor = (names: string[]) => {
    const out: Record<string, Source> = {}
    for (const s of state?.services ?? []) if (names.includes(s.name) && s.kind === 'process') out[s.repo] = sourceOf(s.repo, choice[s.repo] ?? 'main')
    return out
  }
  const start = (st: StackDef) => act(st.id, async () => {
    const names = startNames(st, state!.services)
    return names.length ? window.api.devStack(st.id, sourcesFor(names), names) : 'Everything in this stack is already running.'
  })
  const pick = (s: DevService, value: string) => {
    setChoice((c) => ({ ...c, [s.repo]: value }))
    // switching restarts only this service from the new folder
    if (isLive(s) && !s.external) act(s.name, () => window.api.devStart(s.name, sourceOf(s.repo, value)))
  }
  const shutDown = (st: StackDef) => act(st.id, async () => {
    const names = shutdownNames(st, state!.stacks, state!.services)
    return names.length ? Promise.all(names.map((n) => window.api.devStop(n))) : 'Nothing of this stack is running.'
  })

  const byName = new Map((state?.services ?? []).map((s) => [s.name, s]))
  return (
    <section className="tool" data-testid="stacks-view">
      <div className="dhead">
        <span className="dtitle">Stacks</span>
        {state?.docker.phase === 'starting' && <span className="dnote">{state.docker.message}</span>}
        <span className="dspace" />
        {onClose && <button className="dlink" aria-label="Close" onClick={onClose} data-testid="tool-close">×</button>}
      </div>
      <div className="dbody">
        {!ok && <div className="derr">{state?.message ?? 'Loading...'}</div>}
        {ok && (
          <>
            {state!.message && <div className="dwarn">{state!.message}</div>}
            {state!.docker.phase === 'error' && <div className="derr">{state!.docker.message}</div>}
            {state!.stacks.length === 0 && <div className="dnote">No stacks are defined in .env (HIVE_STACKS).</div>}
            {msg && <pre className="dmsg">{msg}</pre>}
            <div className="dstacks">{state!.stacks.map((st) => {
              const svcs = st.services.map((n) => byName.get(n)).filter((s): s is DevService => !!s)
              const up = svcs.filter((s) => s.state === 'running').length
              const live = svcs.some(isLive)
              return (
                <div key={st.id} className="dstack" data-testid={`stack-${st.id}`}>
                  <div className="drow">
                    <span className="dtitle">{st.label}</span>
                    <span className="dnote">{up}/{svcs.length} running</span>
                    <span className="dspace" />
                    <button data-testid={`stack-start-${st.id}`} className="dbtn primary" disabled={!!busy || !svcs.some((s) => !isLive(s))} onClick={() => start(st)}>{busy === st.id ? 'Working…' : live ? 'Start the rest' : 'Start'}</button>
                    <button data-testid={`stack-stop-${st.id}`} className="dbtn" disabled={!!busy || !live} onClick={() => shutDown(st)}>Shut down</button>
                  </div>
                  <table className="dtable">
                    <thead><tr><th>Service</th><th>Status</th><th>Port</th><th>Run from</th><th>Started by</th><th /></tr></thead>
                    <tbody>
                      {svcs.map((s) => (
                        <tr key={s.name}>
                          <td>{s.label}</td>
                          <td><State word={s.state} tone={STATE_TONE[s.state] ?? 'idle'} />{s.note && <div className="dd">{s.note}</div>}</td>
                          <td>{s.port ?? ''}</td>
                          <td>
                            {s.kind === 'process'
                              ? <select data-testid={`stack-src-${st.id}-${s.name}`} className="dsel" value={valueOf(s)} disabled={!!busy || s.external} onChange={(e) => pick(s, e.target.value)}>
                                  {(opts[s.repo] ?? [{ value: 'main', label: 'main checkout' } as SourceOption]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              : <span className="dnote">docker, main checkout</span>}
                          </td>
                          <td>{s.owner}</td>
                          <td className="dact">
                            {s.open && s.state === 'running' && s.port && <a className="dlink" href={`http://localhost:${s.port}`} target="_blank" rel="noreferrer">Open</a>}
                            <button className="dlink" data-testid={`stack-logs-${s.name}`} onClick={() => (onLogs ? onLogs(s.name) : setLogFor(logFor === s.name ? null : s.name))}>{!onLogs && logFor === s.name ? 'Hide logs' : 'Logs'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}</div>
            {logFor && <pre className="dout" ref={pre}>{logText || '(no output yet)'}</pre>}
          </>
        )}
      </div>
    </section>
  )
}
