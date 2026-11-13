// One piece of background work (a subagent, workflow, Codex run, shell or monitor), folded to a line: its name. Open, it
// says which model runs it, what it is doing now, what it was started with (the prompt or the command), and how much it
// has used; Stop and Message are there too. The one task row of the app: the Activity panel lists these, and so does
// the bar above the message box (there the line also carries the type and the model, and the row ids differ).
import { useState } from 'react'
import { Btn, clock, dur, tokens as fmtTokens } from './kit'
import { taskHeading, type Task } from '../../shared/taskCore'
import { kindName, rowType, runKind, type TaskDetail } from '../../shared/runningBarCore'
import { modelLabel } from '../../shared/statusCore'

const ENDED: Record<Task['status'], string> = { running: 'running', completed: 'done', failed: 'failed', stopped: 'stopped' }

export function TaskItem({ t, tabId, thread, busy, elsewhere, detail, bar, send, onOpen }: {
  t: Task; tabId: string; thread?: string; busy: boolean; elsewhere?: boolean; detail?: TaskDetail; bar?: boolean
  send: (text: string, mode?: 'steer' | 'queue') => void; onOpen?: () => void
}) {
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const now = Date.now()
  const running = t.status === 'running'
  const last = t.now || t.lastTool || t.summary || t.error || ''
  const isAgent = /agent/.test(t.kind)
  // a shell or a monitor: no model, no agent to talk to, and it was started with a command
  const k = runKind(t)
  const command = k === 'shell' || k === 'monitor'
  const go = () => {
    const v = (msg ?? '').trim()
    if (!v) return
    send(`[To subagent "${t.name ? `${t.name}: ` : ''}${t.title}" (task ${t.id})] ${v}`, busy ? 'steer' : undefined)
    setMsg(null)
  }
  const type = [kindName(t), detail?.type || (t.kind !== 'codex' ? t.name : '')].filter(Boolean).join(', ')
  const model = detail?.model || (t.kind === 'codex' ? t.name : '') || ''
  const modelWord = model ? modelLabel(model) : "the thread's model"
  const used = [t.tokens ? `${fmtTokens(t.tokens)} tokens` : '', t.toolUses ? `${t.toolUses} tool calls` : '', t.durationMs ? dur(t.durationMs) : ''].filter(Boolean).join(', ')
  // in the bar the box to message a running subagent is there as soon as its row is open
  const chat = msg !== null || (!!bar && open && running && isAgent)
  return (
    <div className={`item tk st-${t.status}${open ? ' open' : ''}${t.status === 'failed' ? ' failed' : ''}`} data-testid={bar ? undefined : 'activity-item'}>
      <div className="tm">{running ? dur(now - t.startedAt) : bar ? ENDED[t.status] : clock(t.endedAt ?? t.startedAt)}</div>
      <div>
        <button className="tk-head" onClick={() => (elsewhere ? onOpen?.() : setOpen(!open))} aria-expanded={open} title={taskHeading(t)} data-testid={bar ? `running-row-${t.id}` : 'task-toggle'}>
          {!elsewhere && <i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden />}
          <span className="nm">{elsewhere ? `${taskHeading(t)}${t.status === 'failed' ? ' failed' : ''} in ${thread}` : taskHeading(t)}</span>
          {bar && <span className="tk-ty">{command ? rowType(t, detail) : `${rowType(t, detail)}, ${modelWord}`}</span>}
        </button>
        {!open && !bar && last && <div className="ds" title={last}>{last}</div>}
        {open && (
          <div className="tk-body" data-testid={bar ? `running-detail-${t.id}` : 'task-detail'}>
            <div className="tk-row"><i>Type</i><span>{type}</span></div>
            {!command && <div className="tk-row"><i>Model</i><span>{modelWord}</span></div>}
            <div className="tk-row"><i>Now</i><span>{running ? (t.now || t.lastTool || (command ? 'running' : 'working')) : bar ? ENDED[t.status] : t.status}</span></div>
            {used && <div className="tk-row"><i>Used</i><span>{used}</span></div>}
            {(t.error || t.summary) && <div className="tk-row"><i>{t.error ? 'Error' : 'Result'}</i><span>{t.error || t.summary}</span></div>}
            {t.agents.length > 0 && <div className="tk-row"><i>Agents</i><span>{t.agents.map((a) => `${a.label}: ${a.state}${a.result ? `, ${a.result}` : ''}`).join('\n')}</span></div>}
            <div className="tk-row tk-prompt"><i>{command ? 'Command' : 'Prompt'}</i><pre>{detail?.prompt || t.title}</pre></div>
          </div>
        )}
        {chat && (
          <div className="ac"><input className="uline" style={{ flex: 1 }} autoFocus={msg !== null} value={msg ?? ''} placeholder="Message this subagent (Claude passes it on)" onChange={(e) => setMsg(e.target.value)} aria-label="Message this subagent"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } else if (e.key === 'Escape' && !bar) { e.preventDefault(); e.stopPropagation(); setMsg(null) } }} data-testid={`agent-chat-${t.id}`} /></div>
        )}
        <div className="ac">
          {elsewhere && <Btn kind="link" onClick={onOpen}>Open</Btn>}
          {running && <Btn kind="link" onClick={() => void window.api.chatStopTask(tabId, t.id)} testid={`task-stop-${t.id}`}>Stop</Btn>}
          {running && isAgent && !chat && <Btn kind="link" onClick={() => setMsg('')}>Message</Btn>}
          {elsewhere && t.status === 'failed' && <Btn kind="link" onClick={() => send(`Retry the task that failed: ${t.title}`, busy ? 'queue' : undefined)}>Retry</Btn>}
        </div>
      </div>
    </div>
  )
}
