// The thread's live status as text, for the hive agent_status tool: what each subagent, workflow, shell, monitor and
// Codex run is doing, plus loops, the next wake-up and the goal. Built from the same events the UI shows, so Claude
// reports what is really running instead of guessing.
import { describeCron, nextRun, untilText } from './cronCore'
import type { ThreadStatus } from './statusCore'
import { kindLabel, type Task } from './taskCore'

// the counts the top-right card shows
export function runCounts(st: ThreadStatus) {
  const run = st.tasks.filter((t) => t.status === 'running')
  const of = (re: RegExp) => run.filter((t) => re.test(t.kind)).length
  return {
    agents: of(/agent/),
    workflows: of(/workflow/),
    shells: of(/bash|shell/),
    monitors: of(/monitor/),
    codex: of(/^codex$/),
    other: run.filter((t) => !/agent|workflow|bash|shell|monitor|^codex$/.test(t.kind)).length,
  }
}

const line = (t: Task, now: number) => {
  const took = untilText((t.endedAt ?? now) - t.startedAt)
  const bits = [
    `${kindLabel(t.kind)}${t.name && t.kind !== 'codex' ? ` (${t.name})` : ''}: ${t.title}`,
    `  status: ${t.status}, ${t.status === 'running' ? 'running for' : 'took'} ${took}${t.toolUses != null ? `, ${t.toolUses} tool calls` : ''}${t.tokens != null ? `, ${t.tokens} tokens` : ''}`,
    `  task id: ${t.id}`,
  ]
  if (t.status === 'running' && t.now) bits.push(`  doing now: ${t.now}`)
  if (t.status === 'running' && t.lastTool) bits.push(`  last tool: ${t.lastTool}`)
  if (t.summary) bits.push(`  result: ${t.summary.slice(0, 600)}`)
  if (t.error) bits.push(`  error: ${t.error}`)
  return bits.join('\n')
}

export function formatAgentStatus(st: ThreadStatus, now: number, subagentsDir?: string): string {
  const out: string[] = []
  const running = st.tasks.filter((t) => t.status === 'running')
  const ended = st.tasks.filter((t) => t.status !== 'running')
  out.push(running.length ? `Running now (${running.length}):\n${running.map((t) => line(t, now)).join('\n')}` : 'Nothing running in the background.')
  if (ended.length) out.push(`Finished or stopped (${ended.length}):\n${ended.map((t) => line(t, now)).join('\n')}`)
  for (const c of st.crons) {
    const next = nextRun(c.schedule, new Date(now))
    out.push(`Loop ${c.id}: ${c.recurring ? describeCron(c.schedule) : 'once'}${next ? `, next in ${untilText(next.getTime() - now)}` : ''}: ${c.prompt}`)
  }
  if (st.wakeRunning) out.push('A scheduled wake-up is running now.')
  else if (st.nextWake) out.push(`Next wake-up in ${untilText(Math.max(0, st.nextWake - now))}.`)
  if (st.goal) out.push(`Goal (${st.goal.status}): ${st.goal.condition}, set ${untilText(now - st.goal.setAt)} ago`)
  if (subagentsDir && st.tasks.some((t) => /agent/.test(t.kind))) out.push(`Each subagent's full transcript: ${subagentsDir}, one agent-<id>.jsonl each (newest file = latest agent).`)
  return out.join('\n\n')
}
