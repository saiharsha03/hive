// Two views of a thread's background work, over statusStore:
// RunCard: a small card in the chat's top-right corner with counts (subagents, shells, monitors, workflows, Codex),
//   loop and wake-up timers and the goal; it opens to the goal / loop rows with their Stop buttons.
// AgentsDock: the panel above the message box with every task row, a message box per running subagent (sent to
//   Claude, who passes it on with SendMessage) and the thread's queued messages.
import { useState } from 'react'
import { nextRun, untilText } from '../../shared/cronCore'
import { runCounts } from '../../shared/agentStatusCore'
import { inThreadList, shellName, type Task } from '../../shared/taskCore'
import { GoalLoop, TaskRow, describer, openAgentsView, useNow } from './ThreadStatus'
import { useThreadStatus } from './statusStore'
import { Icon } from './ui'

type Send = (text: string, images: never[], mode?: 'steer' | 'queue') => void
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function RunCard({ tabId, busy, onSend, onInterrupt }: { tabId: string; busy: boolean; onSend: Send; onInterrupt: () => Promise<void> | void }) {
  const st = useThreadStatus(tabId)
  const [open, setOpen] = useState(false)
  const c = runCounts(st)
  const any = c.agents + c.workflows + c.shells + c.monitors + c.codex + c.other
  const now = useNow(any > 0 || !!st.goal || st.crons.length > 0 || !!st.nextWake)
  if (!any && !st.goal && !st.crons.length && !st.nextWake && !st.wakeRunning) return null
  const nextLoop = st.crons.map((j) => nextRun(j.schedule, new Date(now))?.getTime()).filter((t): t is number => !!t).sort((a, b) => a - b)[0]
  const chips: [string, string, string][] = [] // icon, text, colour class
  if (c.agents) chips.push(['person', plural(c.agents, 'subagent'), 's-work'])
  if (c.workflows) chips.push(['type-hierarchy', plural(c.workflows, 'workflow'), 's-work'])
  if (c.shells) chips.push(['terminal', plural(c.shells, 'shell'), 's-work'])
  if (c.monitors) chips.push(['eye', plural(c.monitors, 'monitor'), 's-work'])
  if (c.codex) chips.push(['hubot', `${c.codex} Codex`, 's-work'])
  if (c.other) chips.push(['circle-large-outline', plural(c.other, 'task'), 's-work'])
  if (st.crons.length) chips.push(['sync', `${plural(st.crons.length, 'loop')}${st.wakeRunning ? ', running' : nextLoop ? `, next ${untilText(nextLoop - now)}` : ''}`, 's-work'])
  if (st.wakeRunning && !st.crons.length) chips.push(['clock', 'wake-up running', 's-work'])
  else if (st.nextWake) chips.push(['clock', `wake in ${untilText(Math.max(0, st.nextWake - now))}`, 's-wait'])
  if (st.goal) chips.push([st.goal.status === 'met' ? 'pass-filled' : 'target', st.goal.status === 'met' ? 'goal met' : `goal ${untilText(now - st.goal.setAt).replace(/ 0s$/, '')}`, st.goal.status === 'met' ? 's-done' : 's-work'])
  return (
    <div className={open ? 'runcard open' : 'runcard'} data-testid="run-card">
      <button className="rc-chips" onClick={() => setOpen((o) => !o)} title={open ? 'Hide details' : 'Show details'} data-testid="run-card-toggle">
        {chips.map(([icon, text, cls]) => <span key={text} className={`rc-chip ${cls}`}><Icon name={icon} />{text}</span>)}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} className="rc-fold" />
      </button>
      {open && (
        <div className="rc-body">
          {st.tasks.filter((t) => t.status === 'running').map((t) => (
            <div key={t.id} className="rc-task"><span className="rc-k">{t.kind === 'codex' ? 'Codex' : t.name ?? t.kind.replace(/^local_/, '')}</span><span className="rc-t" title={t.title}>{t.now ?? t.title}</span><span className="rc-d">{untilText(now - t.startedAt)}</span></div>
          ))}
          {st.nextWake && !st.wakeRunning && <div className="rc-task"><span className="rc-k">wake-up</span><span className="rc-t">next turn starts by itself</span><span className="rc-d">{new Date(st.nextWake).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>}
          <GoalLoop tabId={tabId} busy={busy} onSend={onSend} onInterrupt={onInterrupt} />
        </div>
      )}
    </div>
  )
}

// what you sent to each subagent in this app session (tab -> task -> messages)
const sentTo = new Map<string, Map<string, { text: string; at: number }[]>>()
const sentOf = (tabId: string, taskId: string) => sentTo.get(tabId)?.get(taskId) ?? []
function remember(tabId: string, taskId: string, text: string) {
  const m = sentTo.get(tabId) ?? new Map()
  m.set(taskId, [...(m.get(taskId) ?? []), { text, at: Date.now() }])
  sentTo.set(tabId, m)
}
// the tab was closed: what was sent to its subagents goes with it
export const forgetSent = (tabId: string) => { sentTo.delete(tabId) }
// Claude passed it on: a SendMessage call whose text holds the start of the message. The calls are written out once
// per conversation state, not for every sent message on every render.
const sends = new WeakMap<Item[], string[]>()
function sendsOf(items: Item[]): string[] {
  let v = sends.get(items)
  if (!v) { v = items.flatMap((it) => (it.kind === 'tool' && it.name === 'SendMessage' ? [JSON.stringify(it.input ?? {})] : [])); sends.set(items, v) }
  return v
}
const passedOn = (items: Item[], text: string) => { const start = JSON.stringify(text.slice(0, 40)).slice(1, -1); return sendsOf(items).some((s) => s.includes(start)) }

function AgentChat({ tabId, t, items, busy, onSend }: { tabId: string; t: Task; items: Item[]; busy: boolean; onSend: Send }) {
  const [text, setText] = useState('')
  const [, bump] = useState(0)
  const sent = sentOf(tabId, t.id)
  const go = () => {
    const v = text.trim()
    if (!v) return
    onSend(`[To subagent "${t.name ? `${t.name}: ` : ''}${t.title}" (task ${t.id})] ${v}`, [], busy ? 'steer' : undefined)
    remember(tabId, t.id, v)
    setText('')
    bump((n) => n + 1)
  }
  return (
    <div className="ad-chat">
      {sent.map((m, i) => (
        <div key={i} className="ad-sent"><span className="ad-you">You</span><span className="ad-txt">{m.text}</span>
          <span className={passedOn(items, m.text) ? 'ad-st s-done' : 'ad-st s-wait'}>{passedOn(items, m.text) ? 'passed on' : 'with Claude, passing on'}</span></div>
      ))}
      {t.status === 'running' && (
        <input className="ad-in" value={text} placeholder="Message this subagent (Claude passes it on)" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } }} data-testid={`agent-chat-${t.id}`} />
      )}
    </div>
  )
}

export function AgentsDock({ tabId, items, busy, onSend, onPromote, onDequeue }: {
  tabId: string; items: Item[]; busy: boolean; onSend: Send; onPromote: (id: string) => void; onDequeue: (id: string) => Promise<unknown> | void
}) {
  const all = useThreadStatus(tabId)
  // folded to its one-line head until clicked: open, the rows took most of the chat while subagents ran
  const [fold, setFold] = useState(true)
  const now = useNow(all.tasks.some((t) => t.status === 'running' || inThreadList(t, Date.now())))
  const name = describer(items)
  const tasks = all.tasks.filter((t) => inThreadList(t, now)).map((t) => ({ ...t, title: shellName(t, name) }))
  const queued = items.filter((it): it is Extract<Item, { kind: 'user' }> => it.kind === 'user' && !!it.queue?.pending)
  if (!tasks.length && !queued.length) return null
  const running = tasks.filter((t) => t.status === 'running').length
  const open = !fold
  return (
    <div className="tasks agents-dock" data-testid="thread-tasks">
      <div className="tasks-head">
        <button className="fold" onClick={() => setFold(open)} data-testid="thread-tasks-toggle">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          <Icon name="type-hierarchy" className="mk-agents" />
          {[running ? `${running} running` : tasks.length ? 'Background work' : '', tasks.length > running ? `${tasks.length - running} finished` : '', queued.length ? `${queued.length} queued` : ''].filter(Boolean).join(', ')}
        </button>
        <button className="link" onClick={openAgentsView} data-testid="thread-tasks-side">Side panel</button>
      </div>
      {open && (
        <div className="tst-list">
          {tasks.map((t) => (
            <div key={t.id}>
              <TaskRow t={t} tabId={tabId} />
              {/agent/.test(t.kind) && (t.status === 'running' || sentOf(tabId, t.id).length > 0) && <AgentChat tabId={tabId} t={t} items={items} busy={busy} onSend={onSend} />}
            </div>
          ))}
          {queued.length > 0 && (
            <div className="ad-queue">
              <div className="ad-qh"><Icon name="inbox" />Queued for Claude</div>
              {queued.map((q) => (
                <div key={q.queue!.id} className="ad-q">
                  <span className="ad-txt" title={q.text}>{q.text || '(image)'}</span>
                  <span className="ad-st s-wait">{q.interrupt ? 'interrupting, sends next' : 'sends when Claude finishes'}</span>
                  <button className="link" onClick={() => onPromote(q.queue!.id)} data-testid="dock-queued-send-now">send now</button>
                  <button className="link" onClick={() => void onDequeue(q.queue!.id)} data-testid="dock-queued-remove">remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
