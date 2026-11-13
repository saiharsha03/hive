// The bar above the message box: what runs for this thread now (subagents, workflows, Codex runs, shells, monitors),
// and what a task was started with, read from the tool call that started it. Pure, so it can be tested without the DOM.
import { SHELL_AFTER_MS, inThreadList, type Task } from './taskCore'

export type RunKind = 'agent' | 'workflow' | 'shell' | 'monitor'
// a Codex run counts with the subagents
export const runKind = (t: Pick<Task, 'kind'>): RunKind =>
  /bash|shell/.test(t.kind) ? 'shell' : /monitor/.test(t.kind) ? 'monitor' : /workflow/.test(t.kind) ? 'workflow' : 'agent'
export const kindName = (t: Pick<Task, 'kind'>): string =>
  t.kind === 'codex' ? 'Codex' : /workflow/.test(t.kind) ? 'Workflow' : /bash|shell/.test(t.kind) ? 'Shell' : /monitor/.test(t.kind) ? 'Monitor' : /agent/.test(t.kind) ? 'Subagent' : t.kind

// What the bar lists: the thread's own list rule (a quick foreground shell never shows, a finished shell is not kept);
// a subagent, workflow or Codex run stays for a minute after it ends so its result does not vanish as it lands, and a
// monitor is listed only while it runs. Agents and workflows first, then shells, then monitors.
const ORDER: RunKind[] = ['agent', 'workflow', 'shell', 'monitor']
export function barTasks(tasks: Task[], now: number): Task[] {
  const listed = tasks.filter((t) => inThreadList(t, now) && (t.status === 'running' || runKind(t) === 'agent' || runKind(t) === 'workflow'))
  const group = (t: Task) => Math.max(1, ORDER.indexOf(runKind(t))) // agents and workflows are one group
  return listed.map((t, i) => ({ t, i })).sort((a, b) => group(a.t) - group(b.t) || a.i - b.i).map((x) => x.t)
}
// when a shell that is still too young to list becomes worth listing (the bar has no clock while it is closed)
export function nextShellDue(tasks: Task[], now: number): number | null {
  const due = tasks.filter((t) => t.kind === 'local_bash' && t.status === 'running' && now - t.startedAt < SHELL_AFTER_MS).map((t) => t.startedAt + SHELL_AFTER_MS)
  return due.length ? Math.min(...due) : null
}

const WORDS: Record<RunKind, [string, string]> = { agent: ['subagent', 'subagents'], workflow: ['workflow', 'workflows'], shell: ['shell', 'shells'], monitor: ['monitor', 'monitors'] }
// "3 subagents running", "2 subagents, 1 shell and 1 monitor running", "5 running: 2 subagents, 1 workflow, 1 shell, 1 monitor";
// agentThreads: the agent threads started from this thread that run or may want you, counted first
export function runningLabel(listed: Task[], agentThreads = 0): { total: number; text: string } {
  const running = listed.filter((t) => t.status === 'running')
  const parts = [agentThreads ? `${agentThreads} agent thread${agentThreads === 1 ? '' : 's'}` : '',
    ...ORDER.map((k) => { const n = running.filter((t) => runKind(t) === k).length; return n ? `${n} ${WORDS[k][n === 1 ? 0 : 1]}` : '' })].filter(Boolean)
  const total = running.length + agentThreads
  if (!total) return { total, text: 'Nothing running' }
  if (parts.length >= ORDER.length) return { total, text: `${total} running: ${parts.join(', ')}` }
  return { total, text: `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]} running` }
}
// the heading over a group of rows, drawn only when more than one group is listed
export const groupName = (t: Pick<Task, 'kind'>): string => (runKind(t) === 'shell' ? 'Shells' : runKind(t) === 'monitor' ? 'Monitors' : 'Subagents and workflows')

// What a subagent, workflow, Codex run or shell was started with, read from the tool call that started it.
export type TaskDetail = { type: string; model: string; prompt: string }
type StartItem = { kind: string; id?: string; input?: any; task?: string; model?: string; allowEdits?: boolean }
export function taskDetail(items: StartItem[], t: Pick<Task, 'id' | 'kind' | 'title' | 'toolUseId'>): TaskDetail | undefined {
  for (const it of items) {
    if (it.kind === 'tool' && t.toolUseId && it.id === t.toolUseId) return { type: String(it.input?.subagent_type ?? it.input?.name ?? ''), model: String(it.input?.model ?? ''), prompt: String(it.input?.prompt ?? it.input?.command ?? it.input?.description ?? '') }
    if (it.kind === 'codex' && t.kind === 'codex' && (it.task === t.title || t.id === `codex:${it.id}`)) return { type: it.allowEdits ? 'can edit files' : 'read only', model: it.model ?? '', prompt: it.task ?? '' }
  }
  return undefined
}
// a row's type in the bar: "general-purpose", "Explore", the workflow's name, "Codex", "Shell", "Monitor"
export function rowType(t: Pick<Task, 'kind' | 'name'>, detail?: TaskDetail): string {
  const k = runKind(t)
  if (t.kind === 'codex' || k === 'shell' || k === 'monitor') return kindName(t)
  return (k === 'agent' && detail?.type) || t.name || kindName(t)
}

// A monitor is a command the Monitor tool started. The engine may report it as a plain shell task, so the tool call
// that started it decides: such a task is listed, named and grouped as a monitor.
export function asMonitors(items: { kind: string; id?: string; name?: string }[], tasks: Task[]): Task[] {
  const monitors = new Set(items.filter((it) => it.kind === 'tool' && it.name === 'Monitor' && it.id).map((it) => it.id!))
  return monitors.size ? tasks.map((t) => (t.toolUseId && monitors.has(t.toolUseId) && !/monitor/.test(t.kind) ? { ...t, kind: 'monitor' } : t)) : tasks
}
