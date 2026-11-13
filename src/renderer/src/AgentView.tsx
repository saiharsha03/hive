// Agent threads: another command-line agent (Codex CLI, OpenCode, any command in Settings > Agents) run in a tab of its
// own, its own terminal as the body (TerminalView's AgentTerminal; the process lives in main's terminal.ts). Orbit cannot
// read its conversation: the state word is main's guess from the terminal (agentThreadCore). Not kept across restarts;
// closing the tab ends it.
import { useCallback } from 'react'
import { parseAgents, type AgentDef, type AgentState } from '../../shared/agentThreadCore'
import { activeId, activate, closeSession, lastThreadId, place } from './actions'
import { activate as activateIn } from './panes'
import { agentThreads, createStore, getSessions, panes, setSessions, useSession, useSessionMetas, useStore } from './store'
import { AgentTerminal, disposeTerminal, restartTerminal, stopTerminal } from './TerminalView'
import { AgentWord } from './AgentWord'
import { Modal } from './ui'

// the agents in Settings, read at start and again after a save
export const agentDefs = createStore<AgentDef[]>([])
export const setAgentDefs = (raw: unknown) => agentDefs.set(parseAgents(raw))
void window.api.settingsGet().then((v) => setAgentDefs(v.general.agents)).catch(() => { /* none until Settings is saved */ })

const setState = (id: string, state: AgentState) => agentThreads.set((a) => (a[id] && a[id].state !== state ? { ...a, [id]: { ...a[id], state } } : a))
window.api.onAgentState((id, state) => setState(id, state))
window.addEventListener('hive:agent-failed', (e) => setState(String((e as CustomEvent).detail), 'failed'))
// its tab closed (actions.closeTabs): the process stops and the screen goes
window.addEventListener('hive:agent-closed', (e) => disposeTerminal(String((e as CustomEvent).detail)))

// the thread in front: the focused tab when it is a thread (or an agent thread), else the thread last focused
const front = () => {
  const all = getSessions()
  const f = all.find((s) => s.id === activeId())
  return f && !f.tool && !f.file ? f : all.find((s) => s.id === lastThreadId())
}

// ---- New agent thread: which agent, and the folder it starts in (the front thread's, else where new threads start) ----
const asking = createStore<{ name: string; folder: string } | null>(null)
export function askAgentThread(name: string) {
  asking.set({ name, folder: front()?.cwd || place.get().workspace || place.get().folder })
}
export function startAgentThread(name: string, cwd: string) {
  const f = front()
  const id = `agent:${Date.now()}`
  agentThreads.set((a) => ({ ...a, [id]: { state: 'running', from: f && !f.agent ? f.id : null } }))
  setSessions((all) => [...all, { id, agent: name, title: name, cwd, items: [], streaming: '', busy: false, loaded: true, background: false }])
  panes.set((p) => activateIn(p, id))
}

export function AgentAsk() {
  const a = useStore(asking, (x) => x)
  const defs = useStore(agentDefs, (x) => x)
  if (!a) return null
  const close = () => asking.set(null)
  const go = () => { const folder = a.folder.trim(); if (!folder) return; close(); startAgentThread(a.name, folder) }
  const pick = () => void window.api.pickFolder().then((f) => { if (f) asking.set((x) => x && { ...x, folder: f }) })
  return (
    <Modal title="New agent thread" onClose={close} testid="agent-ask">
      <div className="confirm">
        <div className="confirm-body">
          <div className="sline">
            <select className="sin" value={a.name} onChange={(e) => asking.set({ ...a, name: e.target.value })} aria-label="Agent" data-testid="agent-ask-agent">
              {defs.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
            <span className="dnote mono">{defs.find((d) => d.name === a.name)?.command}</span>
          </div>
          <div className="sline">
            <input className="sin wide mono" value={a.folder} spellCheck={false} placeholder="Folder" aria-label="Folder" autoFocus data-testid="agent-ask-folder"
              onChange={(e) => asking.set({ ...a, folder: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } }} />
            <button className="dlink" onClick={pick} data-testid="agent-ask-choose">Choose</button>
          </div>
        </div>
        <div className="drow confirm-acts">
          <span className="dspace" />
          <button className="dbtn" onClick={close} data-testid="agent-ask-cancel">Cancel</button>
          <button className="dbtn primary" disabled={!a.folder.trim()} onClick={go} data-testid="agent-ask-ok">Start</button>
        </div>
      </div>
    </Modal>
  )
}

// ---- the tab body: name, state, folder, Restart and Stop, a line on what Orbit does not cover, then the terminal ----
export function AgentPane({ id, focused }: { id: string; focused: boolean }) {
  const s = useSession(id)
  const state = useStore(agentThreads, useCallback((a: ReturnType<typeof agentThreads.get>) => a[id]?.state ?? 'running', [id]))
  if (!s?.agent) return null
  const restart = () => { setState(id, 'running'); void restartTerminal(id) }
  const stop = () => void stopTerminal(id).then(() => setState(id, 'exited'))
  return (
    <div className="termview" data-testid={`agent-${id}`}>
      <div className="term-bar">
        <b>{s.title}</b><AgentWord state={state} />
        <span className="term-cwd" title={s.cwd}>{s.cwd}</span>
        <button onClick={restart} title="Stop it and start it again in the same folder" data-testid="agent-restart">Restart</button>
        <button onClick={stop} disabled={state === 'exited' || state === 'failed'} title="End its process; the tab stays" data-testid="agent-stop">Stop</button>
      </div>
      <div className="term-bar">This agent uses its own sign-in and permission rules, and its usage is not counted in Orbit's limits.</div>
      <AgentTerminal id={id} cwd={s.cwd ?? ''} agent={s.agent} focused={focused} />
    </div>
  )
}

// ---- the rail's "Agents" group ----
export function AgentRows({ focus }: { focus: string | null }) {
  const list = useSessionMetas().filter((s) => s.agent)
  const states = useStore(agentThreads, (a) => a)
  if (!list.length) return null
  return (
    <div data-testid="section-agents">
      <div className="rail-gh"><span>Agents</span><span className="n">{list.length}</span></div>
      {list.map((s) => (
        <div key={s.id} className={`rail-row${focus === s.id ? ' on' : ''}`} role="button" tabIndex={0} title={[s.title, s.cwd].filter(Boolean).join('\n')}
          onClick={() => activate(s.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === 'Enter') { e.preventDefault(); activate(s.id) } }}
          data-testid="agent-row" data-id={s.id}>
          <div className="rail-l1"><span className="rail-t"><span className="tt">{s.title}</span></span><AgentWord state={states[s.id]?.state ?? 'running'} /></div>
          <div className="rail-l2"><span className="rail-now">{(s.cwd ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''}</span></div>
          <button className="more" aria-label="Close agent thread" title="Close (stops it)" onClick={(e) => { e.stopPropagation(); closeSession(s.id) }} data-testid={`agent-close-${s.id}`}>×</button>
        </div>
      ))}
    </div>
  )
}
