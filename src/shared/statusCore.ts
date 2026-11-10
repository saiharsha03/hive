// One thread's live status, folded from its chat events: model and effort, /goal, scheduled loop jobs,
// and background work. Pure, so it can be tested without Electron; the renderer keeps one per tab.
import { goalOnResume, goalReduce, parseGoalReply, type Goal, type GoalMark } from './goalCore'
import { applyTask, type Task } from './taskCore'

export type LoopJob = { id: string; schedule: string; recurring: boolean; prompt: string }

export type ThreadStatus = {
  model?: string
  effort?: string | null // the level the session runs at (Stop hook, or what Hive set)
  ultrathink?: boolean // max effort for this one turn
  effortError?: string
  goal: Goal | null
  crons: LoopJob[]
  wakeRunning: string | null // the scheduled fire running right now (command uuid)
  nextWake: number | null // when the next ScheduleWakeup fires (ms), until it fires or is stopped
  tasks: Task[]
}

export const emptyStatus = (): ThreadStatus => ({ goal: null, crons: [], wakeRunning: null, nextWake: null, tasks: [] })

const textOf = (ev: any): string => (Array.isArray(ev.message?.content) ? ev.message.content : [])
  .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')

// a ScheduleWakeup call in this message: its fire time, null when it stops the loop, undefined when there is none
function wakeOf(ev: any, now: number): number | null | undefined {
  const call = (Array.isArray(ev.message?.content) ? ev.message.content : []).findLast((b: any) => b.type === 'tool_use' && b.name === 'ScheduleWakeup')
  if (!call) return undefined
  if (call.input?.stop) return null
  const secs = Number(call.input?.delaySeconds)
  return Number.isFinite(secs) ? now + Math.min(3600, Math.max(60, secs)) * 1000 : undefined
}

export function reduceStatus(st: ThreadStatus, ev: any, now: number): ThreadStatus {
  if (!ev || typeof ev !== 'object') return st
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') return { ...st, model: ev.model ?? st.model }
      if (typeof ev.subtype === 'string' && (ev.subtype.startsWith('task_') || ev.subtype === 'background_tasks_changed')) {
        return { ...st, tasks: applyTask(st.tasks, ev, now) }
      }
      return st
    case 'assistant': {
      if (ev.parent_tool_use_id) return st // a subagent's model is not the thread's
      const wake = wakeOf(ev, now)
      if (wake !== undefined) st = { ...st, nextWake: wake }
      const model = ev.message?.model
      if (model === '<synthetic>') {
        const reply = parseGoalReply(textOf(ev))
        return reply ? { ...st, goal: goalReduce(st.goal, { t: 'reply', reply, now }) } : st
      }
      return model && model !== st.model ? { ...st, model } : st
    }
    case 'hive_model':
      return { ...st, model: ev.model }
    case 'hive_effort':
      return { ...st, effort: ev.level ?? st.effort, ultrathink: !!ev.ultrathink, effortError: ev.error }
    case 'hive_stop':
      return { ...st, crons: Array.isArray(ev.crons) ? ev.crons : [], effort: ev.effort ?? st.effort }
    case 'hive_goal': {
      const marks: GoalMark[] = Array.isArray(ev.marks) ? ev.marks : []
      if (ev.initial) return { ...st, goal: goalOnResume(marks) ?? st.goal }
      return { ...st, goal: marks.reduce<Goal | null>((g, mark) => goalReduce(g, { t: 'mark', mark }), st.goal) }
    }
    case 'active_goal': // not sent by SDK 0.3.314; handled in case a later one does
      return { ...st, goal: goalReduce(st.goal, { t: 'active_goal', value: ev.value ?? null }) }
    case 'command_lifecycle':
      if (ev.state === 'started' && ev.wakeup_source === 'schedule_wakeup') return { ...st, wakeRunning: ev.command_uuid ?? 'wake', nextWake: null }
      // the wake-up ended: its own uuid, or, when the start came without one ('wake'), any command ending
      if (ev.state !== 'started' && st.wakeRunning && (ev.command_uuid === st.wakeRunning || st.wakeRunning === 'wake')) return { ...st, wakeRunning: null }
      return st
    case 'conversation_reset':
      return { ...st, goal: null }
    case 'hive_codex':
      return { ...st, tasks: applyTask(st.tasks, ev, now) }
    case 'hive_closed':
      // scheduled jobs live in the process and die with it
      return { ...st, crons: [], wakeRunning: null, nextWake: null, ultrathink: false, tasks: applyTask(st.tasks, ev, now) }
  }
  return st
}

// claude-opus-5-5 -> Opus 5.5, claude-opus-4-20250514 -> Opus 4 (a date is not a minor version); anything else as given
export function modelLabel(id?: string | null): string {
  if (!id) return ''
  const m = id.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/)
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id
}

// the effort levels, lowest first: the one list for the thread's picker and the Settings default (settingsCore.ts)
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
