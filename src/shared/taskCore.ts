// A thread's background work: workflows (phases and agents), subagents, shells, and Hive's own Codex runs,
// from the SDK's task_* messages and Hive's hive_codex events. Pure, so it can be tested without Electron.

export type TaskAgent = {
  key: string
  label: string
  state: string // start / running / done / failed / ...
  phase?: string
  model?: string
  tokens?: number
  toolCalls?: number
  durationMs?: number
  startedAt?: number
  result?: string
}
export type TaskPhase = { index: number; title: string }
export type Task = {
  id: string
  kind: string // local_workflow, local_agent, local_bash, codex, ...
  title: string
  name?: string // workflow name
  status: 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: number
  endedAt?: number
  tokens?: number
  toolUses?: number
  durationMs?: number
  lastTool?: string
  now?: string // live one-line status from agentProgressSummaries ("Reading the dbt models")
  summary?: string
  error?: string
  phases: TaskPhase[]
  agents: TaskAgent[]
  toolUseId?: string // the tool call that started it
  backgrounded?: boolean // in the background (that tool call returned at once), so its row follows this task's state
  listed?: boolean // seen in the engine's in-flight list (background_tasks_changed): leaving that list ends it
}

const STATUS: Record<string, Task['status']> = {
  pending: 'running', running: 'running', paused: 'running',
  completed: 'completed', failed: 'failed', killed: 'stopped', stopped: 'stopped',
}

function upsert(tasks: Task[], id: string, make: () => Task, patch: (t: Task) => Task): Task[] {
  const i = tasks.findIndex((t) => t.id === id)
  if (i < 0) return [...tasks, patch(make())]
  const next = tasks.slice()
  next[i] = patch(tasks[i])
  return next
}

const blank = (id: string, now: number, over: Partial<Task> = {}): Task => ({ id, kind: 'task', title: id, status: 'running', startedAt: now, phases: [], agents: [], ...over })

// merge a workflow_progress list (a snapshot or a delta: both merge by key)
function mergeProgress(t: Task, list: any[]): Task {
  const phases = t.phases.slice()
  const agents = t.agents.slice()
  for (const p of list) {
    if (p?.type === 'workflow_phase') {
      const i = phases.findIndex((x) => x.index === p.index)
      const v = { index: p.index, title: String(p.title ?? `Phase ${p.index}`) }
      if (i < 0) phases.push(v); else phases[i] = v
    } else if (p?.type === 'workflow_agent') {
      const key = String(p.agentId ?? `${p.phaseIndex ?? 0}:${p.index}`)
      const i = agents.findIndex((x) => x.key === key)
      const old = i < 0 ? undefined : agents[i]
      const v: TaskAgent = {
        key,
        label: String(p.label ?? old?.label ?? `Agent ${p.index}`),
        state: String(p.state ?? old?.state ?? 'start'),
        phase: p.phaseTitle ?? old?.phase,
        model: p.model ?? old?.model,
        tokens: p.tokens ?? old?.tokens,
        toolCalls: p.toolCalls ?? old?.toolCalls,
        durationMs: p.durationMs ?? old?.durationMs,
        startedAt: p.startedAt ?? old?.startedAt,
        result: p.resultPreview ?? old?.result,
      }
      if (i < 0) agents.push(v); else agents[i] = v
    }
  }
  phases.sort((a, b) => a.index - b.index)
  return { ...t, phases, agents }
}

export function applyTask(tasks: Task[], ev: any, now: number): Task[] {
  if (ev?.type === 'hive_codex') {
    if (ev.phase === 'start') return upsert(tasks, `codex:${ev.id}`, () => blank(`codex:${ev.id}`, now, { kind: 'codex', title: String(ev.task ?? 'Codex'), name: ev.model || undefined }), (t) => t)
    if (ev.phase === 'line') return upsert(tasks, `codex:${ev.id}`, () => blank(`codex:${ev.id}`, now, { kind: 'codex', title: 'Codex' }), (t) => ({ ...t, lastTool: String(ev.line ?? '').slice(0, 200) }))
    if (ev.phase === 'done') return upsert(tasks, `codex:${ev.id}`, () => blank(`codex:${ev.id}`, now, { kind: 'codex', title: 'Codex' }), (t) => ({
      ...t, status: ev.ok ? 'completed' : 'failed', endedAt: now, durationMs: now - t.startedAt, summary: String(ev.answer ?? ''),
    }))
    return tasks
  }
  if (ev?.type === 'hive_closed') {
    // the process ended: whatever it was running is gone (Codex runs stop with the tab too)
    return tasks.map((t) => (t.status === 'running' ? { ...t, status: 'stopped', endedAt: now } : t))
  }
  if (ev?.type !== 'system') return tasks
  const id = ev.task_id as string | undefined
  switch (ev.subtype) {
    case 'task_started':
      return upsert(tasks, id!, () => blank(id!, now), (t) => ({
        ...t,
        kind: ev.task_type ?? (ev.subagent_type ? 'local_agent' : t.kind),
        title: String(ev.description ?? t.title),
        name: ev.workflow_name ?? ev.subagent_type ?? t.name,
        ...(ev.tool_use_id ? { toolUseId: String(ev.tool_use_id) } : {}),
        ...(ev.is_backgrounded === true ? { backgrounded: true } : {}),
        status: 'running',
      }))
    case 'task_progress':
      return upsert(tasks, id!, () => blank(id!, now), (t) => {
        const u = ev.usage ?? {}
        const next: Task = { ...t, tokens: u.total_tokens ?? t.tokens, toolUses: u.tool_uses ?? t.toolUses, durationMs: u.duration_ms ?? t.durationMs, lastTool: ev.last_tool_name ?? t.lastTool, now: ev.summary ? String(ev.summary) : t.now }
        if (t.title === t.id && ev.summary) next.title = String(ev.summary)
        return Array.isArray(ev.workflow_progress) ? mergeProgress(next, ev.workflow_progress) : next
      })
    case 'task_updated': {
      const p = ev.patch ?? {}
      return upsert(tasks, id!, () => blank(id!, now), (t) => ({
        ...t,
        status: p.status ? STATUS[p.status] ?? t.status : t.status,
        title: p.description ?? t.title,
        endedAt: p.end_time ?? t.endedAt,
        error: p.error ?? t.error,
        ...(p.is_backgrounded === true ? { backgrounded: true } : {}), // moved to the background later (Ctrl+B)
      }))
    }
    case 'task_notification':
      return upsert(tasks, id!, () => blank(id!, now), (t) => {
        const u = ev.usage ?? {}
        return {
          ...t,
          status: STATUS[ev.status] ?? 'completed',
          summary: ev.summary ?? t.summary,
          endedAt: t.endedAt ?? now,
          tokens: u.total_tokens ?? t.tokens,
          toolUses: u.tool_uses ?? t.toolUses,
          durationMs: u.duration_ms ?? t.durationMs,
        }
      })
    case 'background_tasks_changed': {
      // the in-flight list: add any we missed. A task that was on the list and is no longer on it has ended, even if
      // its own notification never came (it used to stay "running" until the tab closed, which blocked a rewind);
      // a notification that does come later still sets the real outcome
      const inFlight = new Set<string>((ev.tasks ?? []).map((b: any) => b.task_id))
      const kept = tasks.map((t) => (inFlight.has(t.id) ? (t.listed ? t : { ...t, listed: true })
        : t.listed && t.status === 'running' ? { ...t, status: 'completed' as const, endedAt: t.endedAt ?? now } : t))
      return (ev.tasks ?? []).reduce((all: Task[], b: any) => (all.some((t) => t.id === b.task_id) ? all
        : [...all, blank(b.task_id, now, { kind: b.task_type ?? 'task', title: String(b.description ?? b.task_id), listed: true })]), kept)
    }
  }
  return tasks
}

// "local_workflow" -> "Workflow"
export function kindLabel(kind: string): string {
  if (kind === 'codex') return 'Codex'
  if (/workflow/.test(kind)) return 'Workflow'
  if (/agent/.test(kind)) return 'Subagent'
  if (/bash|shell/.test(kind)) return 'Shell'
  return kind.replace(/^local_/, '').replace(/_/g, ' ')
}

// The engine reports every shell command as a task, foreground ones too. Worth listing as background work: subagents,
// workflows and Codex runs always; a shell only while it has been running a while (a quick command is already a row in
// the chat), and a finished shell never (its output is in the chat, not a result waiting for anyone).
export const SHELL_AFTER_MS = 15_000
export function worthListing(t: Task, now: number): boolean {
  if (t.kind !== 'local_bash') return true
  // a shell started in the background (a monitor's command is one) is background work from its first second; only a
  // foreground command has to outlast the wait before it is listed
  return t.status === 'running' && (t.backgrounded === true || now - t.startedAt >= SHELL_AFTER_MS)
}

// what the thread's own lists show: running work, and finished work for a minute after it ended (it then drops out
// by itself; the Agents view uses the same rule)
export const DONE_SHOWN_MS = 60_000
export const inThreadList = (t: Task, now: number): boolean =>
  worthListing(t, now) && (t.status === 'running' || (!!t.endedAt && now - t.endedAt < DONE_SHOWN_MS))

// What the Activity panel lists from the other threads: their running work, and a subagent, workflow or Codex run that
// failed within the hour. A shell that "failed" only exited non-zero (normal for a check that is meant to fail one
// way) and its output is in its own chat, so it is never listed as a failure, nor is a monitor.
export const FAILED_SHOWN_MS = 3_600_000
export function elsewhereListed(t: Task, now: number): boolean {
  if (!worthListing(t, now)) return false
  if (t.status === 'running') return true
  return t.status === 'failed' && !/bash|shell|monitor/.test(t.kind) && now - (t.endedAt ?? 0) < FAILED_SHOWN_MS
}

// a review: a Codex run, or a subagent or workflow asked to review, audit or scan (its name, title, type or the start
// of its prompt says so). Never a shell or a monitor.
export function isReviewTask(t: Pick<Task, 'kind' | 'title' | 'name'>, detail?: { type?: string; prompt?: string }): boolean {
  if (/bash|shell|monitor/.test(t.kind)) return false
  return t.kind === 'codex' || /\b(review|reviewer|audit|security[- ]scan|verify|verdict)\b/i.test(`${t.name ?? ''} ${t.title} ${detail?.type ?? ''} ${(detail?.prompt ?? '').slice(0, 400)}`)
}

// a shell's name: the short description its command was run with, when the thread's tool rows have it
export function shellName(t: Task, describe: (command: string) => string | undefined): string {
  return t.kind === 'local_bash' ? describe(t.title) ?? t.title : t.title
}

// A task's heading in Activity, Running and on the phone. A workflow is named as one, with its script's name
// ("Workflow spec: Review the auth change"); anything else is its own title.
export function taskHeading(t: Pick<Task, 'kind' | 'title' | 'name'>): string {
  if (!/workflow/.test(t.kind)) return t.title
  const head = `Workflow${t.name ? ` ${t.name}` : ''}`
  return t.title && t.title !== t.name && t.title !== t.kind ? `${head}: ${t.title}` : head
}
