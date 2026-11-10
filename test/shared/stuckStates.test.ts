// States that used to stay on until the tab closed: a wake-up marked running, and background work marked running.
import { describe, expect, it } from 'vitest'
import { EFFORTS, emptyStatus, modelLabel, reduceStatus } from '../../src/shared/statusCore'
import { EFFORTS as SETTINGS_EFFORTS, normalizeSettings } from '../../src/shared/settingsCore'
import { applyTask, type Task } from '../../src/shared/taskCore'
import { rewindBlock } from '../../src/shared/rewindCore'

const life = (state: string, extra: object = {}) => ({ type: 'command_lifecycle', state, ...extra })

describe('a scheduled wake-up', () => {
  it('ends with its own command', () => {
    let st = reduceStatus(emptyStatus(), life('started', { wakeup_source: 'schedule_wakeup', command_uuid: 'u1' }), 0)
    expect(st.wakeRunning).toBe('u1')
    st = reduceStatus(st, life('completed', { command_uuid: 'other' }), 1)
    expect(st.wakeRunning).toBe('u1') // another command ending is not this one
    expect(reduceStatus(st, life('completed', { command_uuid: 'u1' }), 2).wakeRunning).toBeNull()
  })

  it('that started without a command id ends with the next command that ends', () => {
    const st = reduceStatus(emptyStatus(), life('started', { wakeup_source: 'schedule_wakeup' }), 0)
    expect(st.wakeRunning).toBe('wake')
    expect(reduceStatus(st, life('completed'), 1).wakeRunning).toBeNull() // used to stay "running" for good
    expect(reduceStatus(st, life('completed', { command_uuid: 'u9' }), 1).wakeRunning).toBeNull()
    expect(reduceStatus(st, life('started', { command_uuid: 'u9' }), 1).wakeRunning).toBe('wake') // a start is not an end
  })
})

describe('background work', () => {
  const list = (...ids: string[]) => ({ type: 'system', subtype: 'background_tasks_changed', tasks: ids.map((task_id) => ({ task_id, task_type: 'local_agent', description: `agent ${task_id}` })) })
  const running = (tasks: Task[]) => tasks.filter((t) => t.status === 'running').map((t) => t.id)

  it('that leaves the in-flight list has ended, even when its own notification never came', () => {
    let tasks = applyTask([], list('a', 'b'), 100)
    expect(running(tasks)).toEqual(['a', 'b'])
    tasks = applyTask(tasks, list('b'), 200)
    expect(running(tasks)).toEqual(['b'])
    expect(tasks.find((t) => t.id === 'a')).toMatchObject({ status: 'completed', endedAt: 200 })
    tasks = applyTask(tasks, list(), 300)
    expect(running(tasks)).toEqual([])
    // nothing running any more: a rewind is not refused for good
    expect(rewindBlock({ busy: false, runningTasks: running(tasks), codexRuns: 0, rewinding: false })).toBeNull()
  })

  it('still takes the real outcome from a notification that comes later', () => {
    let tasks = applyTask(applyTask([], list('a'), 100), list(), 200)
    tasks = applyTask(tasks, { type: 'system', subtype: 'task_notification', task_id: 'a', status: 'failed', summary: 'boom' }, 250)
    expect(tasks[0]).toMatchObject({ status: 'failed', summary: 'boom', endedAt: 200 })
  })

  it('that was never on the list is left alone: a foreground command and a Codex run end on their own events', () => {
    let tasks = applyTask([], { type: 'system', subtype: 'task_started', task_id: 'fg', task_type: 'local_bash', description: 'npm test' }, 100)
    tasks = applyTask(tasks, { type: 'hive_codex', phase: 'start', id: 'c1', task: 'review' }, 110)
    tasks = applyTask(tasks, list('a'), 120)
    tasks = applyTask(tasks, list(), 130)
    expect(running(tasks)).toEqual(['fg', 'codex:c1'])
  })

  it('a task started on its own and then listed ends when it leaves the list', () => {
    let tasks = applyTask([], { type: 'system', subtype: 'task_started', task_id: 'a', subagent_type: 'Explore', description: 'look' }, 100)
    tasks = applyTask(tasks, list('a'), 110)
    expect(tasks).toHaveLength(1)
    expect(running(applyTask(tasks, list(), 120))).toEqual([])
  })
})

describe('labels and lists', () => {
  it('a model id with a date is not given a made-up minor version', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelLabel('claude-opus-4-20250514')).toBe('Opus 4') // was "Opus 4.20250514"
    expect(modelLabel('claude-haiku-5-5[1m]')).toBe('Haiku 5.5')
    expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022')
    expect(modelLabel('haiku')).toBe('haiku')
    expect(modelLabel(null)).toBe('')
  })

  it('there is one list of effort levels, xhigh included', () => {
    expect(EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(SETTINGS_EFFORTS).toBe(EFFORTS)
    // a default saved before the lists were one still loads
    for (const e of EFFORTS) expect(normalizeSettings({ general: { effort: e } })!.general.effort).toBe(e)
  })
})
