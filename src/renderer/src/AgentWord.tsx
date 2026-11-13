// Agent threads (AgentView.tsx) as the tab row and a thread's running bar show them: the state word and the rows the
// bar counts. Only the stores here, so the conversation view does not load the terminal (xterm) or the actions.
import { useCallback } from 'react'
import { agentLabel, type AgentState } from '../../shared/agentThreadCore'
import { activateSession } from './background'
import { activate as activateIn } from './panes'
import { agentThreads, panes, setSessions, useSessionMetas, useStore } from './store'

// the word, in its colour: running = work, waiting = signal, failed = fail, exited = dim
export function AgentWord({ state }: { state: AgentState }) {
  return <span className={`agent-st ${state}`} data-testid="agent-state">{agentLabel(state)}</span>
}

// bring an agent thread's tab to the front (a background one comes back), as actions.activate does
export function openAgentTab(id: string) {
  setSessions((all) => activateSession(all, id))
  panes.set((p) => activateIn(p, id))
}

// a thread's running bar: the agent threads started from it that are running or may want you
export function useBarAgents(tabId: string): { id: string; title: string; state: AgentState }[] {
  const key = useStore(agentThreads, useCallback((a: ReturnType<typeof agentThreads.get>) =>
    Object.entries(a).filter(([, x]) => x.from === tabId && (x.state === 'running' || x.state === 'waiting')).map(([id, x]) => `${id}=${x.state}`).join(' '), [tabId]))
  const titles = useSessionMetas()
  return key.split(' ').filter(Boolean).map((kv) => {
    const [id, state] = kv.split('=')
    return { id, title: titles.find((s) => s.id === id)?.title ?? id, state: state as AgentState }
  })
}
