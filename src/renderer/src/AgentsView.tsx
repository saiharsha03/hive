// Agents: every thread's live background work in one place (workflows with their phases, subagents, Codex runs,
// shells), the threads working or waiting, and finished results waiting for you.
import type { LiveRow } from './background'
import type { Session } from './chat'
import { useAllStatus } from './statusStore'
import { describer, TaskRow, useNow } from './ThreadStatus'
import { shellName, worthListing } from '../../shared/taskCore'
import { liveLook } from './Sidebar'
import { Icon } from './ui'

type Live = { waiting: LiveRow[]; working: LiveRow[] }

export function AgentsView({ sessions, live, onActivate }: { sessions: Session[]; live: Live; onActivate: (id: string) => void }) {
  const all = useAllStatus()
  const title = (id: string) => sessions.find((s) => s.id === id)?.title ?? id
  const known = new Set(sessions.map((s) => s.id))
  const running: { tab: string; t: import('../../shared/taskCore').Task }[] = []
  const finished: typeof running = []
  const now = useNow([...all.values()].some((st) => st.tasks.some((t) => t.status === 'running')))
  // only real background work (quick and finished shells are rows in their chat), shells named by their description
  for (const [tab, st] of all) {
    if (!known.has(tab)) continue
    const name = describer(sessions.find((s) => s.id === tab)?.items ?? [])
    for (const t of st.tasks) if (worthListing(t, now)) (t.status === 'running' ? running : finished).push({ tab, t: { ...t, title: shellName(t, name) } })
  }
  const waiting = live.waiting
  const empty = !running.length && !finished.length && !live.working.length && !waiting.length
  return (
    <div className="agents" data-testid="agents-view">
      {empty && <div className="pane-empty">No agents running. Workflows, subagents and Codex runs from any thread show up here.</div>}
      {running.length > 0 && (
        <section>
          <div className="cap"><Icon name="type-hierarchy" className="mk-agents" />Running <span className="n">{running.length}</span></div>
          {running.map(({ tab, t }) => (
            <div key={`${tab}:${t.id}`} className="ag-item">
              <button className="ag-from" onClick={() => onActivate(tab)} title="Open the thread" data-testid={`agents-open-${tab}`}>from {title(tab)}</button>
              <TaskRow t={t} tabId={tab} open={t.phases.length > 0} />
            </div>
          ))}
        </section>
      )}
      {(live.working.length > 0 || waiting.length > 0) && (
        <section>
          <div className="cap"><Icon name="pulse" />Threads <span className="n">{live.working.length} working, {waiting.length} waiting</span></div>
          {[...waiting, ...live.working].map((r) => {
            const look = liveLook(r)
            return (
              <button key={r.id} className="ag-row" onClick={() => onActivate(r.id)} data-testid={`agents-thread-${r.id}`}>
                <Icon name={look.icon} className={look.cls} />
                <span className="ag-t">{r.title}</span>
                <span className="ag-n">{r.note}</span>
                <span className={`st ${look.cls.replace(' spin', '')}`}>{look.word}</span>
              </button>
            )
          })}
        </section>
      )}
      {finished.length > 0 && (
        <section>
          <div className="cap"><Icon name="pass" />Finished, results waiting for you <span className="n">{finished.length}</span></div>
          {finished.map(({ tab, t }) => (
            <div key={`${tab}:${t.id}`} className="ag-item">
              <button className="ag-from" onClick={() => onActivate(tab)} data-testid={`agents-open-done-${tab}`}>from {title(tab)}</button>
              <TaskRow t={t} tabId={tab} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
