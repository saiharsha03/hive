// A thread's live status, in three places: goal and loop rows in the chat header, the model and effort pickers
// (popovers) in the message box, and its background work (workflows, subagents, Codex runs) above the message box.
// Plain views over statusStore; the logic is in shared/*Core.
import { Fragment, useEffect, useRef, useState } from 'react'
import { advisorChecked, advisorItems, advisorModelOf, advisorWord, isAdvisorValue } from '../../shared/advisorCore'
import { describeCron, nextRun, untilText } from '../../shared/cronCore'
import { EFFORTS, modelLabel } from '../../shared/statusCore'
import { createStore, useStore } from './store'
import { getPref, setPref } from './prefs'
import { kindLabel, type Task } from '../../shared/taskCore'
import { dismissGoal, setPicked, useThreadStatus } from './statusStore'
import { Icon, Popover, anchorOf, type Anchor } from './ui'

type Send = (text: string, images: never[], mode?: 'steer' | 'queue') => void

export function useNow(on: boolean) {
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

const kindIcon = (kind: string) => (kind === 'codex' ? 'hubot' : kind.includes('workflow') ? 'type-hierarchy' : kind.includes('bash') ? 'terminal' : 'person')
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
      {t.status === 'running' && (t.now || t.lastTool) && !open && <div className="tsk-last">{t.now ?? t.lastTool}</div>}
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

// a thread's shell commands by their short description (the Bash / PowerShell input), for naming its shell tasks
// built once per conversation state (the items array is replaced when it changes), not on every render or clock tick
const described = new WeakMap<Item[], (command: string) => string | undefined>()
export function describer(items: Item[]): (command: string) => string | undefined {
  const have = described.get(items)
  if (have) return have
  const m = new Map<string, string>()
  for (const it of items) if (it.kind === 'tool' && typeof it.input?.command === 'string' && typeof it.input?.description === 'string') m.set(it.input.command, it.input.description)
  const f = (c: string) => m.get(c)
  described.set(items, f)
  return f
}
// the app opens the Agents view (every thread's background work) in its side panel
let showAgents: () => void = () => {}
export const setShowAgents = (f: () => void) => { showAgents = f }
export const openAgentsView = () => showAgents()

type PickItem = { value: string; label: string; note?: string; group?: string }
function PickList({ anchor, items, value, isOn, onPick, onClose, testid, loading }: {
  anchor: Anchor; items: PickItem[]; value?: string | null; isOn?: (v: string) => boolean; onPick: (v: string) => void; onClose: () => void; testid: string; loading?: boolean
}) {
  const on = (v: string) => (isOn ? isOn(v) : v === value)
  return (
    <Popover anchor={anchor} onClose={onClose} width={260} testid={testid}>
      <div className="poplist">
        {loading && <div className="pop-hint">Loading…</div>}
        {items.map((m, i) => (
          <Fragment key={m.value}>
            {m.group && m.group !== items[i - 1]?.group && <div className="pop-group" data-testid={`${testid}-group`}>{m.group}</div>}
            <button className={on(m.value) ? 'pop-row on' : 'pop-row'} onClick={() => { onPick(m.value); onClose() }} data-testid={`${testid}-${m.value}`}>
              <Icon name={on(m.value) ? 'check' : 'blank'} />
              <span className="pop-label">{m.label}</span>
              {m.note && <span className="pop-note">{m.note}</span>}
            </button>
          </Fragment>
        ))}
      </div>
    </Popover>
  )
}

// the Settings > General advisor model, the Default row's value (read when the model menu opens)
let advisorDefault = ''
const readAdvisorDefault = () => window.api.settingsGet().then((s) => { advisorDefault = s.general.advisorModel ?? ''; return advisorDefault }).catch(() => advisorDefault)

// What a thread with no model or effort of its own runs on (this app's defaults, else Claude Code's), kept for every
// message box; saving a default (from the pickers' Default group) writes Settings > General.
type Defaults = { model: string; effort: string; own: { model: string; effort: string } }
const defaults = createStore<Defaults>({ model: '', effort: '', own: { model: '', effort: '' } })
const loadDefaults = () => void window.api.defaultsGet().then((d) => defaults.set(d)).catch(() => {})
loadDefaults()
async function saveDefault(patch: { model?: string; effort?: string }) {
  const v = await window.api.settingsGet()
  const general = { ...v.general, ...(patch.model !== undefined ? { model: patch.model } : {}), ...(patch.effort !== undefined ? { effort: patch.effort as typeof v.general.effort } : {}) }
  const r = await window.api.settingsSave({ env: v.env, scripts: v.scripts, general })
  if (!r.ok) throw new Error(r.problems.map((p) => p.message).join('; ') || 'Could not save the default')
  loadDefaults()
}
// a model alias ("fable") or id, as a name
const nameOf = (m: string) => { const l = modelLabel(m); return l === m && /^[a-z]+$/.test(m) ? m[0].toUpperCase() + m.slice(1) : l }
const DEFAULT_PICK = 'default:'

// model and effort pickers for the message box: a button each, the list in a popover
export function ModelEffort({ tabId, ultra }: { tabId: string; ultra: boolean }) {
  const st = useThreadStatus(tabId)
  const dfl = useStore(defaults, (d) => d)
  // what a thread really ran on, remembered for the next new thread's label
  const [seen, setSeen] = useState(() => getPref<{ model: string; effort: string }>('default.seen', { model: '', effort: '' }))
  useEffect(() => {
    if (!st.model) return
    const now = { model: st.model, effort: st.effort ?? seen.effort }
    if (now.model !== seen.model || now.effort !== seen.effort) { setSeen(now); setPref('default.seen', now) }
  }, [st.model, st.effort])
  const [models, setModels] = useState<{ value: string; displayName: string }[] | null>(null)
  const [open, setOpen] = useState<'model' | 'effort' | 'advisor' | null>(null)
  const [err, setErr] = useState('')
  const mref = useRef<HTMLButtonElement>(null)
  const eref = useRef<HTMLButtonElement>(null)
  const aref = useRef<HTMLButtonElement>(null)
  const openAdvisor = () => {
    setOpen(open === 'advisor' ? null : 'advisor')
    void readAdvisorDefault().then(setDflt)
    if (!models) { setLoadErr(false); window.api.chatModels(tabId).then(setModels).catch(() => setLoadErr(true)) }
  }
  // a list that failed to load is asked for again the next time the picker opens
  const [loadErr, setLoadErr] = useState(false)
  const openModels = () => {
    setOpen(open === 'model' ? null : 'model')
    void readAdvisorDefault().then(setDflt)
    if (!models) { setLoadErr(false); window.api.chatModels(tabId).then(setModels).catch(() => setLoadErr(true)) }
  }
  const levels: string[] = [...EFFORTS]
  if (st.effort && !levels.includes(st.effort)) levels.push(st.effort)
  const thinking = ultra || st.ultrathink
  const [dflt, setDflt] = useState(advisorDefault)
  useEffect(() => { void readAdvisorDefault().then(setDflt) }, [])
  const word = advisorWord(st, dflt, modelLabel)
  const advisorOn = advisorChecked(st, dflt)
  const pickAdvisor = (v: string) => {
    const was = { advisorPick: st.advisorPick, advisor: st.advisor }
    setErr('')
    setPicked(tabId, { advisorPick: v, advisor: undefined })
    window.api.chatSetAdvisor(tabId, advisorModelOf(v, dflt)).catch((x) => { setPicked(tabId, was); setErr(String(x?.message ?? x)) })
  }
  return (
    <>
      <button ref={mref} className="pick" onClick={openModels} title={err || 'Model for this thread'} aria-haspopup="listbox" data-testid="model-picker">
        <i>Model</i>{st.model ? modelLabel(st.model) : dfl.model ? `${nameOf(dfl.model)} (default)` : seen.model ? `${modelLabel(seen.model)} (default)` : 'default'}
      </button>
      <button ref={eref} className={thinking ? 'pick ultra' : 'pick'} onClick={() => setOpen(open === 'effort' ? null : 'effort')} title={thinking ? 'ultrathink: max effort for this turn' : 'Effort for this thread'} aria-haspopup="listbox" data-testid="effort-picker">
        <i>Effort</i>{thinking ? 'max, ultrathink' : st.effort ?? (dfl.own.effort ? `${dfl.own.effort} (default)` : seen.effort ? `${seen.effort} (default)` : 'medium (default)')}
      </button>
      <button ref={aref} className="pick" onClick={openAdvisor} title="The advisor for this thread: a second model Claude can ask for advice" aria-haspopup="listbox" data-testid="advisor-picker">
        <i>Advisor</i>{word ? word.replace(/^advisor /, 'advisor ') : 'advisor off'}
      </button>
      {(err || st.effortError) && <span className="pick-err" title={err || st.effortError}>switch failed, kept the old one</span>}
      {open === 'model' && (
        <PickList anchor={anchorOf(mref.current)} isOn={(v) => (v.startsWith(DEFAULT_PICK) ? v.slice(DEFAULT_PICK.length) === dfl.own.model : isAdvisorValue(v) ? v === advisorOn : v === st.model)} loading={!models && !loadErr} testid="model-list" onClose={() => setOpen(null)}
          items={[...(st.model && models && !models.some((m) => m.value === st.model) ? [{ value: st.model, label: modelLabel(st.model) }] : []), ...(models ?? []).map((m) => ({ value: m.value, label: m.displayName })),
            ...(models ?? []).filter((m) => m.value !== 'default').map((m) => ({ value: DEFAULT_PICK + m.value, label: m.displayName, group: 'Default for new threads' }))]}
          onPick={(v) => { if (v.startsWith(DEFAULT_PICK)) { setErr(''); void saveDefault({ model: v.slice(DEFAULT_PICK.length) }).catch((x) => setErr(String(x?.message ?? x))); return } if (isAdvisorValue(v)) { pickAdvisor(v); return } const was = st.model; setErr(''); setPicked(tabId, { model: v }); window.api.chatSetModel(tabId, v).catch((x) => { setPicked(tabId, { model: was ?? undefined }); setErr(String(x?.message ?? x)) }) }} />
      )}
      {open === 'advisor' && (
        <PickList anchor={anchorOf(aref.current)} isOn={(v) => v === advisorOn} loading={!models && !loadErr} testid="advisor-list" onClose={() => setOpen(null)}
          items={models ? advisorItems(models, dflt, modelLabel) : []}
          onPick={(v) => pickAdvisor(v)} />
      )}
      {open === 'effort' && (
        <PickList anchor={anchorOf(eref.current)} isOn={(v) => (v.startsWith(DEFAULT_PICK) ? v.slice(DEFAULT_PICK.length) === dfl.own.effort : v === st.effort)} testid="effort-list" onClose={() => setOpen(null)}
          items={[...levels.map((l) => ({ value: l, label: l })), ...EFFORTS.map((l) => ({ value: DEFAULT_PICK + l, label: l, group: 'Default for new threads' }))]}
          onPick={(v) => { if (v.startsWith(DEFAULT_PICK)) { setErr(''); void saveDefault({ effort: v.slice(DEFAULT_PICK.length) }).catch((x) => setErr(String(x?.message ?? x))); return } const was = st.effort; setErr(''); setPicked(tabId, { effort: v }); window.api.chatSetEffort(tabId, v).catch((x) => { setPicked(tabId, { effort: was ?? undefined }); setErr(String(x?.message ?? x)) }) }} />
      )}
    </>
  )
}

// the permission mode picker for the message box: bypass, auto, accept edits, ask before tools, plan
const MODE_ROWS: { value: string; label: string; note: string }[] = [
  { value: 'bypassPermissions', label: 'Bypass permissions', note: 'runs everything without asking' },
  { value: 'auto', label: 'Auto', note: 'a classifier decides what is safe to run' },
  { value: 'acceptEdits', label: 'Accept edits', note: 'file edits run; commands ask first' },
  { value: 'default', label: 'Ask before tools', note: 'asks before edits and commands' },
  { value: 'plan', label: 'Plan', note: 'reads and plans; nothing is changed' },
]
export function ModePicker({ tabId, mode, error }: { tabId: string; mode: string; error?: string }) {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLButtonElement>(null)
  const row = MODE_ROWS.find((m) => m.value === mode)
  return (
    <>
      <button ref={ref} className={mode === 'bypassPermissions' ? 'pick warn' : 'pick'} onClick={() => setOpen(!open)} title={error || err || 'Permission mode of this thread: click to change it'} aria-haspopup="listbox" data-testid="mode-picker">
        <i>Mode</i>{(row?.label ?? mode).toLowerCase()}{error || err ? ', switch failed' : ''}
      </button>
      {open && (
        <PickList anchor={anchorOf(ref.current)} value={mode} testid="mode-list" onClose={() => setOpen(false)}
          items={MODE_ROWS.map((m) => ({ value: m.value, label: m.label, note: m.note }))}
          onPick={(v) => { setErr(''); window.api.chatSetMode(tabId, v).catch((x) => setErr(String(x?.message ?? x))) }} />
      )}
    </>
  )
}

// the active thread's model and effort, for the status bar
export function ModelBadge({ tabId }: { tabId: string | null | undefined }) {
  const st = useThreadStatus(tabId)
  if (!tabId || (!st.model && !st.effort)) return null
  return (
    <span className="sbi" title="Model and effort of the focused thread (change them in the message box)" data-testid="top-model">
      <Icon name="sparkle" className="mk-model" />{modelLabel(st.model)}{st.effort ? `, ${st.effort}${st.ultrathink ? ' (ultrathink)' : ''}` : ''}
    </span>
  )
}
