// The bar above the message box: what runs for this thread now. At rest one line ("2 subagents and 1 shell running");
// open, a row per task (TaskItem, the same row the Activity panel lists), grouped by kind. It reads the thread's status
// store, so a streaming reply does not re-render it, and it keeps a clock only while it is open.
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { useThreadStatus } from './statusStore'
import { describer, useNow } from './ThreadStatus'
import { TaskItem } from './TaskItem'
import { useEscape } from './ui'
import { shellName } from '../../shared/taskCore'
import { asMonitors, barTasks, groupName, nextShellDue, runningLabel, taskDetail } from '../../shared/runningBarCore'
import { AgentWord, openAgentTab, useBarAgents } from './AgentWord'

// open or closed, per thread, for the app's life
const opened = new Map<string, boolean>()
const foldedBy = new Map<string, Set<string>>()

export const RunningBar = memo(function RunningBar({ tabId, items, busy, onSend }: {
  tabId: string; items: Item[]; busy: boolean; onSend: (text: string, images: never[], mode?: 'steer' | 'queue') => void
}) {
  const raw = useThreadStatus(tabId).tasks
  const tasks = useMemo(() => asMonitors(items, raw), [items, raw])
  const [open, setOpenState] = useState(() => opened.get(tabId) ?? false)
  useEffect(() => { setOpenState(opened.get(tabId) ?? false) }, [tabId])
  const setOpen = (v: boolean) => { opened.set(tabId, v); setOpenState(v) }
  useNow(open)
  const now = Date.now()
  // closed, nothing ticks: a shell that is about to be worth listing asks for one render at that moment
  const due = nextShellDue(tasks, now)
  const [, wake] = useState(0)
  useEffect(() => {
    if (due === null) return
    const t = setTimeout(() => wake((n) => n + 1), Math.max(0, due - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [due])
  const name = useMemo(() => describer(items), [items])
  // a section (Subagents and workflows, Shells, Monitors) folds to its heading and count; kept per thread
  const [folded, setFolded] = useState<Set<string>>(() => foldedBy.get(tabId) ?? new Set())
  useEffect(() => { setFolded(foldedBy.get(tabId) ?? new Set()) }, [tabId])
  const fold = (g: string) => setFolded((cur) => { const n = new Set(cur); if (n.has(g)) n.delete(g); else n.add(g); foldedBy.set(tabId, n); return n })
  const listed = barTasks(tasks, now)
  const agents = useBarAgents(tabId) // agent threads started from this thread, running or waiting
  const label = runningLabel(listed, agents.length)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const shown = label.total > 0 || (open && listed.length > 0)
  const AGENTS = 'Agents'
  // Escape inside the open bar closes it, before it reaches "stop Claude"
  useEscape(() => {
    if (!root.current?.contains(document.activeElement)) return false
    setOpen(false)
    button.current?.focus()
  }, open && shown)
  if (!shown) return null
  const lead = label.text.startsWith(`${label.total} `)
  const groups = new Set(listed.map(groupName)).size + (agents.length ? 1 : 0)
  return (
    <div className={open ? 'runbar open' : 'runbar'} ref={root}>
      <button ref={button} className="runbar-b" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Hide what is running' : 'Show what is running: type, model, prompt and what each is doing now'} data-testid="running-bar">
        {label.total > 0 && <i className="codicon codicon-loading" aria-hidden />}
        {/* the count is the label's first word when one kind runs; with several kinds the label already says each */}
        {lead ? <span><b data-testid="running-count">{label.total}</b>{label.text.slice(String(label.total).length)}</span> : <span>{label.text}<b hidden data-testid="running-count">{label.total}</b></span>}
        <span className="runbar-h">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="runbar-list">
          {agents.length > 0 && (
            <>
              <button type="button" className="runbar-g" onClick={() => fold(AGENTS)} aria-expanded={!folded.has(AGENTS)} title={folded.has(AGENTS) ? 'Show these' : 'Hide these'} data-testid="running-group-agents">
                <i className={`codicon codicon-chevron-${folded.has(AGENTS) ? 'right' : 'down'}`} aria-hidden />{AGENTS}<span className="runbar-gn">{agents.length}</span>
              </button>
              {!folded.has(AGENTS) && agents.map((a) => (
                <button key={a.id} type="button" className="runbar-agent" onClick={() => openAgentTab(a.id)} title="Open this agent thread" data-testid="running-agent">
                  <span>{a.title}</span><AgentWord state={a.state} />
                </button>
              ))}
            </>
          )}
          {listed.map((t, i) => (
            <Fragment key={t.id}>
              {groups > 1 && groupName(t) !== (i ? groupName(listed[i - 1]) : '') && (
                <button type="button" className="runbar-g" onClick={() => fold(groupName(t))} aria-expanded={!folded.has(groupName(t))} title={folded.has(groupName(t)) ? 'Show these' : 'Hide these'} data-testid={`running-group-${groupName(t).split(' ')[0].toLowerCase()}`}>
                  <i className={`codicon codicon-chevron-${folded.has(groupName(t)) ? 'right' : 'down'}`} aria-hidden />{groupName(t)}<span className="runbar-gn">{listed.filter((x) => groupName(x) === groupName(t)).length}</span>
                </button>
              )}
              {/* a shell is named by the description it was run with; its command stays in the detail */}
              {!(groups > 1 && folded.has(groupName(t))) && <TaskItem bar t={{ ...t, title: shellName(t, name) }} tabId={tabId} busy={busy} detail={taskDetail(items, t) ?? { type: '', model: '', prompt: t.title }} send={(text, mode) => onSend(text, [], mode)} />}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
})
