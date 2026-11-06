// Agents: the background work of the thread on screen (workflows with their phases, subagents, Codex runs, shells),
// or every thread's with "All threads", plus the threads working or waiting. Finished work shows for a minute, as in
// the thread's own list, then drops out; its result stays in the thread.
import { useState } from 'react'
import type { LiveRow } from './background'
import type { Session } from './chat'
import { useAllStatus } from './statusStore'
import { describer, TaskRow, useNow } from './ThreadStatus'
import { inThreadList, shellName } from '../../shared/taskCore'
import { liveLook } from './Sidebar'
import { Icon } from './ui'

type Live = { waiting: LiveRow[]; working: LiveRow[] }

export function AgentsView({ sessions, live, current, onActivate }: { sessions: Session[]; live: Live; current?: string; onActivate: (id: string) => void }) {
  const all = useAllStatus()
  const [everyThread, setEveryThread] = useState(false)
  const scoped = !everyThread && !!current
  const title = (id: string) => sessions.find((s) => s.id === id)?.title ?? id
  const known = new Set(sessions.map((s) => s.id))
  const running: { tab: string; t: import('../../shared/taskCore').Task }[] = []
  const finished: typeof running = []
  const now = useNow([...all.values()].some((st) => st.tasks.some((t) => t.status === 'running' || inThreadList(t, Date.now()))))
  // only real background work (quick shells are rows in their chat), shells named by their description
  for (const [tab, st] of all) {
    if (!known.has(tab) || (scoped && tab !== current)) continue
    const name = describer(sessions.find((s) => s.id === tab)?.items ?? [])
    for (const t of st.tasks) if (inThreadList(t, now)) (t.status === 'running' ? running : finished).push({ tab, t: { ...t, title: shellName(t, name) } })
  }
  const waiting = scoped ? [] : live.waiting
  const working = scoped ? [] : live.working
  const empty = !running.length && !finished.length && !working.length && !waiting.length
  return (
    <div className="agents" data-testid="agents-view">
      {current && (
        <div className="cap">
          <span>{scoped ? title(current) : 'All threads'}</span>
          <button className="link n" onClick={() => setEveryThread(!everyThread)} data-testid="agents-scope">{scoped ? 'All threads' : 'This thread'}</button>
        </div>
      )}
      {empty && <div className="pane-empty">Nothing running{scoped ? ' in this thread' : ''}. Subagents, workflows and Codex runs, long commands, and working threads show up here.</div>}
      {/* three kinds, each its own group: agents (subagents, workflows, Codex), long-running commands, then threads */}
      {([['agents', 'Agents', 'type-hierarchy', running.filter(({ t }) => t.kind !== 'local_bash')], ['commands', 'Commands', 'terminal', running.filter(({ t }) => t.kind === 'local_bash')]] as const).map(([key, label, icon, rows]) => rows.length > 0 && (
        <section key={key} data-testid={`agents-section-${key}`}>
          <div className="cap"><Icon name={icon} className="mk-agents" />{label} <span className="n">{rows.length} running</span></div>
          {rows.map(({ tab, t }) => (
            <div key={`${tab}:${t.id}`} className="ag-item">
              {!scoped && <button className="ag-from" onClick={() => onActivate(tab)} title="Open the thread" data-testid={`agents-open-${tab}`}>from {title(tab)}</button>}
              <TaskRow t={t} tabId={tab} open={t.phases.length > 0} />
            </div>
          ))}
        </section>
      ))}
      {(working.length > 0 || waiting.length > 0) && (
        <section>
          <div className="cap"><Icon name="pulse" />Threads <span className="n">{working.length} working, {waiting.length} waiting</span></div>
          {[...waiting, ...working].map((r) => {
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
          <div className="cap"><Icon name="pass" />Just finished <span className="n">{finished.length}</span></div>
          {finished.map(({ tab, t }) => (
            <div key={`${tab}:${t.id}`} className="ag-item">
              {!scoped && <button className="ag-from" onClick={() => onActivate(tab)} data-testid={`agents-open-done-${tab}`}>from {title(tab)}</button>}
              <TaskRow t={t} tabId={tab} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
