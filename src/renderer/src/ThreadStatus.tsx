// A thread's live status, in three places: goal and loop rows in the chat header, the model and effort pickers
// (popovers) in the message box, and its background work (workflows, subagents, Codex runs) above the message box.
// Plain views over statusStore; the logic is in shared/*Core.
import { useEffect, useRef, useState } from 'react'
import { describeCron, nextRun, untilText } from '../../shared/cronCore'
import { EFFORTS, modelLabel } from '../../shared/statusCore'
import { kindLabel, type Task } from '../../shared/taskCore'
import { clearFinished, dismissGoal, setPicked, useThreadStatus } from './statusStore'
import { Icon, Popover, anchorOf, type Anchor } from './ui'

type Send = (text: string, images: never[], mode?: 'steer' | 'queue') => void

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

const ago = (ms: number) => untilText(ms).replace(/ 0s$/, '')
const k = (n?: number) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M tok` : n >= 1000 ? `${Math.round(n / 1000)}k tok` : `${n} tok`)
const dur = (ms?: number) => (ms == null ? '' : ms < 1000 ? `${ms}ms` : untilText(ms))

export const kindIcon = (kind: string) => (kind === 'codex' ? 'hubot' : kind.includes('workflow') ? 'type-hierarchy' : kind.includes('bash') ? 'terminal' : 'person')
const stateIcon = (s: string) => (s === 'running' || s === 'start' ? 'loading spin s-work' : s === 'failed' ? 'error s-fail' : s === 'done' || s === 'completed' ? 'pass-filled s-done' : 'circle-large-outline s-idle')

export function TaskRow({ t, tabId, open: startOpen = false }: { t: Task; tabId: string; open?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const [err, setErr] = useState('')
  const stop = () => window.api.chatStopTask(tabId, t.id).then((ok) => { if (!ok) setErr('already ended') }).catch((e) => setErr(String(e?.message ?? e)))
  const hasMore = t.phases.length > 0 || t.agents.length > 0 || !!t.summary
  const agentRow = (a: Task['agents'][number]) => (
    <div key={a.key} className={`tsk-agent ${a.state}`}>
      <span className={`codicon codicon-${stateIcon(a.state)}`} />
      <span className="tsk-al">{a.label}</span>
      <span className="tsk-meta">{[a.model ? modelLabel(a.model) : '', k(a.tokens), dur(a.durationMs)].filter(Boolean).join(', ')}</span>
      {a.result && <span className="tsk-res" title={a.result}>{a.result}</span>}
    </div>
  )
  return (
    <div className={`tsk ${t.status}`} data-testid={`task-${t.id}`}>
      <div className="tsk-head">
        <Icon name={kindIcon(t.kind)} className="mk-agents" />
        <span className="tsk-kind">{kindLabel(t.kind)}</span>
        <span className="tsk-title" title={t.title}>{t.name && t.kind !== 'codex' ? `${t.name}: ` : ''}{t.title}</span>
        <span className="tsk-meta">{[k(t.tokens), dur(t.durationMs ?? (t.endedAt ? t.endedAt - t.startedAt : undefined))].filter(Boolean).join(', ')}</span>
        <span className={`tsk-status ${t.status} ${t.status === 'running' ? 's-work' : t.status === 'failed' ? 's-fail' : t.status === 'completed' ? 's-done' : ''}`}>{t.status === 'running' ? 'RUNNING' : t.status.toUpperCase()}</span>
        {hasMore && <button className="link" onClick={() => setOpen((o) => !o)} data-testid={`task-details-${t.id}`}>{open ? 'Hide' : 'Details'}</button>}
        {t.status === 'running' && <button className="link danger" onClick={() => void stop()} data-testid={`task-stop-${t.id}`}>Stop</button>}
      </div>
      {t.status === 'running' && t.lastTool && !open && <div className="tsk-last">{t.lastTool}</div>}
      {err && <div className="tsk-last">{err}</div>}
      {open && (
        <div className="tsk-body">
          {t.phases.length > 0 && (
            <div className="phases" style={{ gridTemplateColumns: `repeat(${Math.min(t.phases.length, 4)}, minmax(0, 1fr))` }}>
              {t.phases.map((p) => {
                const as = t.agents.filter((a) => a.phase === p.title)
                const run = as.some((a) => a.state === 'running' || a.state === 'start')
                const done = as.length > 0 && as.every((a) => a.state === 'done' || a.state === 'completed')
                return (
                  <div key={p.index} className="phase">
                    <div className="phase-t"><span>{p.title}</span><span className={`st ${run ? 's-work' : done ? 's-done' : 's-idle'}`}>{run ? 'RUNNING' : done ? 'DONE' : as.length ? '' : 'QUEUED'}</span></div>
                    {as.map(agentRow)}
                  </div>
                )
              })}
            </div>
          )}
          {t.agents.filter((a) => !t.phases.some((p) => p.title === a.phase)).map(agentRow)}
          {t.summary && <div className="tsk-sum">{t.summary}</div>}
          {t.error && <div className="tsk-sum err">{t.error}</div>}
        </div>
      )}
    </div>
  )
}

// goal and loop rows for the chat header
export function GoalLoop({ tabId, busy, onSend, onInterrupt }: { tabId: string; busy: boolean; onSend: Send; onInterrupt: () => Promise<void> | void }) {
  const st = useThreadStatus(tabId)
  const now = useNow(!!st.goal || st.crons.length > 0)
  if (!st.goal && !st.crons.length) return null
  // /goal keeps Claude going until it is met, so a busy thread is stopped first and the clear queued behind it
  const stopGoal = async () => {
    if (busy) { await onInterrupt(); onSend('/goal clear', [], 'queue') } else onSend('/goal clear', [])
  }
  const stopLoop = () => onSend(
    `Cancel the scheduled loop in this session: call CronList, then CronDelete every job it lists (${st.crons.map((c) => c.id).join(', ')}). Reply only with the ids you cancelled.`,
    [], busy ? 'queue' : undefined,
  )
  return (
    <div className="runs" data-testid="thread-goal-loop">
      {st.goal && (
        <>
          <span className={`rk ${st.goal.status === 'met' ? 's-done' : 's-work'}`}><Icon name={st.goal.status === 'met' ? 'pass-filled' : 'target'} />GOAL</span>
          <span className="rv" title={[st.goal.condition, st.goal.reason].filter(Boolean).join('\n\n')}>{st.goal.condition}</span>
          <span className={`rt ${st.goal.status === 'met' ? 's-done' : 's-work'}`}>{st.goal.status === 'met'
            ? `met${st.goal.metAt ? ` after ${ago(st.goal.metAt - st.goal.setAt)}` : ''}`
            : `working ${ago(now - st.goal.setAt)}${st.goal.iterations ? `, check ${st.goal.iterations}` : ''}`}</span>
          {st.goal.status === 'active'
            ? <button className="rstop" onClick={() => void stopGoal()} data-testid="goal-stop"><Icon name="debug-stop" />Stop goal</button>
            : <button className="rstop" onClick={() => dismissGoal(tabId)} data-testid="goal-dismiss">Dismiss</button>}
        </>
      )}
      {st.crons.length > 0 && (
        <>
          <span className="rk s-work"><Icon name="sync" />LOOP</span>
          <span className="rv" title={st.crons.map((c) => `${c.id}  ${c.schedule}  ${c.prompt}`).join('\n')}>{st.crons.map((c) => c.prompt).join('; ')}</span>
          <span className="rt s-work">{st.crons.map((c) => {
            const next = nextRun(c.schedule, new Date(now))
            return `${c.recurring ? describeCron(c.schedule) : 'once'}${st.wakeRunning ? ', running now' : next ? `, next in ${untilText(next.getTime() - now)}` : ''}`
          }).join('; ')}</span>
          <button className="rstop" onClick={stopLoop} title="Asks Claude to cancel its scheduled jobs (closing the thread also ends them)" data-testid="loop-stop"><Icon name="debug-stop" />Stop loop</button>
        </>
      )}
    </div>
  )
}

// the background-work list above the message box (also shown in the Agents view)
export function TaskList({ tabId }: { tabId: string }) {
  const st = useThreadStatus(tabId)
  const [open, setOpen] = useState(true)
  if (!st.tasks.length) return null
  const running = st.tasks.filter((t) => t.status === 'running').length
  return (
    <div className="tasks" data-testid="thread-tasks">
      <div className="tasks-head">
        <button className="fold" onClick={() => setOpen((o) => !o)} data-testid="thread-tasks-toggle">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          <Icon name="type-hierarchy" className="mk-agents" />
          {running ? `${running} running` : 'Background work'}{st.tasks.length > running ? `, ${st.tasks.length - running} finished` : ''}
        </button>
        {open && st.tasks.length > running && <button className="link" onClick={() => clearFinished(tabId)} data-testid="thread-tasks-clear">Clear finished</button>}
      </div>
      {open && <div className="tst-list">{st.tasks.map((t) => <TaskRow key={t.id} t={t} tabId={tabId} />)}</div>}
    </div>
  )
}

function PickList({ anchor, items, value, onPick, onClose, testid, loading }: {
  anchor: Anchor; items: { value: string; label: string; note?: string }[]; value?: string | null; onPick: (v: string) => void; onClose: () => void; testid: string; loading?: boolean
}) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={260} testid={testid}>
      <div className="poplist">
        {loading && <div className="pop-hint">Loading…</div>}
        {items.map((m) => (
          <button key={m.value} className={m.value === value ? 'pop-row on' : 'pop-row'} onClick={() => { onPick(m.value); onClose() }} data-testid={`${testid}-${m.value}`}>
            <Icon name={m.value === value ? 'check' : 'blank'} />
            <span className="pop-label">{m.label}</span>
            {m.note && <span className="pop-note">{m.note}</span>}
          </button>
        ))}
      </div>
    </Popover>
  )
}

// model and effort pickers for the message box: a button each, the list in a popover
export function ModelEffort({ tabId, ultra }: { tabId: string; ultra: boolean }) {
  const st = useThreadStatus(tabId)
  const [models, setModels] = useState<{ value: string; displayName: string }[] | null>(null)
  const [open, setOpen] = useState<'model' | 'effort' | null>(null)
  const [err, setErr] = useState('')
  const mref = useRef<HTMLButtonElement>(null)
  const eref = useRef<HTMLButtonElement>(null)
  const openModels = () => {
    setOpen(open === 'model' ? null : 'model')
    if (!models) window.api.chatModels(tabId).then(setModels).catch(() => setModels([]))
  }
  const levels: string[] = [...EFFORTS]
  if (st.effort && !levels.includes(st.effort)) levels.push(st.effort)
  const thinking = ultra || st.ultrathink
  return (
    <>
      <button ref={mref} className="dd" onClick={openModels} title={err || 'Model for this thread'} data-testid="model-picker">
        <Icon name="sparkle" className="mk-model" /><span>{st.model ? modelLabel(st.model) : 'Model'}</span><Icon name="chevron-down" className="sm" />
      </button>
      <button ref={eref} className={thinking ? 'dd ultra' : 'dd'} onClick={() => setOpen(open === 'effort' ? null : 'effort')} title={thinking ? 'ultrathink: max effort for this turn' : 'Effort for this thread'} data-testid="effort-picker">
        <Icon name="lightbulb" /><span>Effort: {st.effort ?? 'default'}{thinking ? ' (ultrathink)' : ''}</span><Icon name="chevron-down" className="sm" />
      </button>
      {(err || st.effortError) && <span className="tst-err" title={err || st.effortError}>switch failed</span>}
      {open === 'model' && (
        <PickList anchor={anchorOf(mref.current)} value={st.model} loading={!models} testid="model-list" onClose={() => setOpen(null)}
          items={[...(st.model && models && !models.some((m) => m.value === st.model) ? [{ value: st.model, label: modelLabel(st.model) }] : []), ...(models ?? []).map((m) => ({ value: m.value, label: m.displayName }))]}
          onPick={(v) => { setErr(''); setPicked(tabId, { model: v }); window.api.chatSetModel(tabId, v).catch((x) => setErr(String(x?.message ?? x))) }} />
      )}
      {open === 'effort' && (
        <PickList anchor={anchorOf(eref.current)} value={st.effort} testid="effort-list" onClose={() => setOpen(null)}
          items={levels.map((l) => ({ value: l, label: l }))}
          onPick={(v) => { setErr(''); setPicked(tabId, { effort: v }); window.api.chatSetEffort(tabId, v).catch((x) => setErr(String(x?.message ?? x))) }} />
      )}
    </>
  )
}

// the active thread's model and effort, for the status bar
export function ModelBadge({ tabId, onClick }: { tabId: string | null | undefined; onClick?: () => void }) {
  const st = useThreadStatus(tabId)
  if (!tabId || (!st.model && !st.effort)) return null
  return (
    <button className="sbi" title="Model and effort of the focused thread" onClick={onClick} data-testid="top-model">
      <Icon name="sparkle" className="mk-model" />{modelLabel(st.model)}{st.effort ? `, ${st.effort}${st.ultrathink ? ' (ultrathink)' : ''}` : ''}
    </button>
  )
}
