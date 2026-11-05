import { test } from 'vitest'
import assert from 'node:assert/strict'
import { emptyStatus, reduceStatus } from '../../src/shared/statusCore'
import { formatAgentStatus, runCounts } from '../../src/shared/agentStatusCore'

const wakeCall = (input: object) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'ScheduleWakeup', input }] } })

test('next wake-up: set by ScheduleWakeup, cleared when it fires or stops; subagent calls ignored', () => {
  let s = reduceStatus(emptyStatus(), wakeCall({ delaySeconds: 600 }), 1000)
  assert.equal(s.nextWake, 601_000)
  s = reduceStatus(s, { ...wakeCall({ delaySeconds: 5 }), parent_tool_use_id: 'x' }, 0)
  assert.equal(s.nextWake, 601_000)
  s = reduceStatus(s, { type: 'command_lifecycle', command_uuid: 'c', state: 'started', wakeup_source: 'schedule_wakeup' }, 0)
  assert.equal(s.nextWake, null)
  s = reduceStatus(s, wakeCall({ delaySeconds: 10 }), 0)
  assert.equal(s.nextWake, 60_000) // clamped to the 60s minimum
  assert.equal(reduceStatus(s, wakeCall({ stop: true }), 0).nextWake, null)
})

test('agent status: counts and text from task events, a stopped agent reads as stopped', () => {
  let s = emptyStatus()
  s = reduceStatus(s, { type: 'system', subtype: 'task_started', task_id: 'a1', task_type: 'local_agent', subagent_type: 'general-purpose', description: 'Fable review' }, 0)
  s = reduceStatus(s, { type: 'system', subtype: 'task_progress', task_id: 'a1', summary: 'Reading the dbt models', last_tool_name: 'Read', usage: { tool_uses: 4 } }, 1000)
  s = reduceStatus(s, { type: 'system', subtype: 'task_started', task_id: 'b1', task_type: 'local_bash', description: 'npm test' }, 0)
  assert.deepEqual([runCounts(s).agents, runCounts(s).shells], [1, 1])
  const text = formatAgentStatus(s, 90_000)
  assert.match(text, /Running now \(2\)/)
  assert.match(text, /doing now: Reading the dbt models/)
  s = reduceStatus(s, { type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status: 'killed' } }, 0)
  assert.equal(runCounts(s).agents, 0)
  assert.match(formatAgentStatus(s, 90_000), /Finished or stopped \(1\):\nSubagent \(general-purpose\): Fable review\n  status: (stopped|killed)/)
})
