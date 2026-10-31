import { test } from 'vitest'
import assert from 'node:assert/strict'
import { emptyStatus, modelLabel, reduceStatus } from '../../src/shared/statusCore'

test('status: model, effort, goal, loop and tasks from chat events', () => {
  let s = emptyStatus()
  s = reduceStatus(s, { type: 'system', subtype: 'init', model: 'claude-opus-5-5' }, 0)
  assert.equal(s.model, 'claude-opus-5-5')
  s = reduceStatus(s, { type: 'assistant', parent_tool_use_id: 'x', message: { model: 'claude-haiku-5-5', content: [] } }, 0)
  assert.equal(s.model, 'claude-opus-5-5') // a subagent's model does not count
  s = reduceStatus(s, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Set model to `Haiku 5.5` for this session only' }] } }, 0)
  assert.equal(s.model, 'claude-opus-5-5') // synthetic never sets the model
  s = reduceStatus(s, { type: 'assistant', message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }] } }, 0)
  assert.equal(s.model, 'claude-sonnet-5-5')
  s = reduceStatus(s, { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Goal set: tests pass' }] } }, 5000)
  assert.deepEqual([s.goal?.condition, s.goal?.status, s.goal?.setAt], ['tests pass', 'active', 5000])
  s = reduceStatus(s, { type: 'hive_stop', crons: [{ id: '3ec52475', schedule: '*/1 * * * *', recurring: true, prompt: 'say ping' }], effort: 'medium' }, 0)
  assert.deepEqual([s.crons.length, s.effort], [1, 'medium'])
  s = reduceStatus(s, { type: 'command_lifecycle', command_uuid: 'c1', state: 'started', wakeup_source: 'schedule_wakeup' }, 0)
  assert.equal(s.wakeRunning, 'c1')
  s = reduceStatus(s, { type: 'command_lifecycle', command_uuid: 'other', state: 'completed' }, 0)
  assert.equal(s.wakeRunning, 'c1')
  s = reduceStatus(s, { type: 'command_lifecycle', command_uuid: 'c1', state: 'completed' }, 0)
  assert.equal(s.wakeRunning, null)
  s = reduceStatus(s, { type: 'hive_effort', level: 'max', ultrathink: true }, 0)
  assert.deepEqual([s.effort, s.ultrathink], ['max', true])
  s = reduceStatus(s, { type: 'hive_effort', level: 'medium' }, 0)
  assert.deepEqual([s.effort, s.ultrathink], ['medium', false])
  s = reduceStatus(s, { type: 'hive_goal', marks: [{ status: { met: true, condition: 'tests pass', reason: 'green' }, at: 9000 }] }, 0)
  assert.deepEqual([s.goal?.status, s.goal?.metAt, s.goal?.setAt], ['met', 9000, 5000])
  s = reduceStatus(s, { type: 'system', subtype: 'task_started', task_id: 't1', description: 'd', task_type: 'local_workflow' }, 0)
  assert.equal(s.tasks.length, 1)
  const same = reduceStatus(s, { type: 'stream_event', event: {} }, 0)
  assert.equal(same, s) // nothing to change: same object, no re-render
  s = reduceStatus(s, { type: 'conversation_reset' }, 0)
  assert.equal(s.goal, null)
  s = reduceStatus(s, { type: 'hive_closed' }, 0)
  assert.deepEqual([s.crons.length, s.tasks[0].status], [0, 'stopped'])
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5')
  assert.equal(modelLabel('sonnet'), 'sonnet')
})
