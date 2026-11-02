import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyTask, kindLabel, type Task } from '../../src/shared/taskCore'

test('tasks: the workflow run from the SDK dump', () => {
  const evs = readFileSync(new URL('../fixtures/workflow_tasks.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.type === 'system' && /^(task_|background_tasks_changed)/.test(e.subtype))
  assert.ok(evs.length >= 6)
  const states: string[] = []
  const tasks = evs.reduce<Task[]>((all, ev, i) => { const r = applyTask(all, ev, 1000 + i); states.push(r[0]?.agents[0]?.state ?? '-'); return r }, [])
  assert.equal(tasks.length, 1)
  const t = tasks[0]
  assert.deepEqual([t.id, t.kind, t.name, t.status], ['w8e2xxqvo', 'local_workflow', 'workflow-smoke-test', 'completed'])
  assert.equal(kindLabel(t.kind), 'Workflow')
  assert.deepEqual(t.phases, [{ index: 1, title: 'p1' }])
  assert.equal(t.agents.length, 1)
  assert.deepEqual([t.agents[0].label, t.agents[0].state, t.agents[0].tokens, t.agents[0].durationMs, t.agents[0].result, t.agents[0].phase], ['ok', 'done', 38789, 1358, 'ok', 'p1'])
  assert.ok(states.includes('start') && states.at(-1) === 'done')
  assert.equal(t.tokens, 38789)
  assert.match(t.summary!, /completed/)
})
test('tasks: Codex runs, subagents, stop, process end', () => {
  let ts = applyTask([], { type: 'hive_codex', id: 'ab', phase: 'start', task: 'review it', model: 'gpt' }, 10)
  ts = applyTask(ts, { type: 'hive_codex', id: 'ab', phase: 'line', line: '$ ls' }, 20)
  assert.deepEqual([ts[0].id, ts[0].kind, ts[0].status, ts[0].lastTool], ['codex:ab', 'codex', 'running', '$ ls'])
  ts = applyTask(ts, { type: 'system', subtype: 'task_started', task_id: 'a1', description: 'explore', subagent_type: 'Explore' }, 30)
  ts = applyTask(ts, { type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status: 'killed', end_time: 40 } }, 40)
  assert.deepEqual([ts[1].kind, ts[1].name, ts[1].status], ['local_agent', 'Explore', 'stopped'])
  ts = applyTask(ts, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'b9', task_type: 'local_bash', description: 'npm test' }] }, 50)
  assert.equal(ts.length, 3)
  ts = applyTask(ts, { type: 'hive_closed' }, 60)
  assert.deepEqual(ts.map((t) => t.status), ['stopped', 'stopped', 'stopped'])
  ts = applyTask(ts, { type: 'hive_codex', id: 'ab', phase: 'done', ok: true, answer: 'fine' }, 70)
  assert.deepEqual([ts[0].status, ts[0].summary], ['completed', 'fine'])
  assert.equal(applyTask(ts, { type: 'assistant' }, 80), ts)
})

test('a task started by a tool call remembers that call, so its row can follow the task', () => {
  const ts = applyTask([], { type: 'system', subtype: 'task_started', task_id: 'b1', description: 'review', subagent_type: 'general-purpose', tool_use_id: 'toolu_9' }, 0)
  assert.equal(ts[0].toolUseId, 'toolu_9')
  assert.equal(applyTask([], { type: 'system', subtype: 'task_started', task_id: 'b2', description: 'x' }, 0)[0].toolUseId, undefined)
})

test('only tasks in the background follow their tool row (started there, or moved there later)', () => {
  let ts = applyTask([], { type: 'system', subtype: 'task_started', task_id: 'f', description: 'fg', tool_use_id: 'toolu_f', is_backgrounded: false }, 0)
  assert.ok(!ts[0].backgrounded)
  ts = applyTask(ts, { type: 'system', subtype: 'task_updated', task_id: 'f', patch: { is_backgrounded: true } }, 1)
  assert.ok(ts[0].backgrounded)
  assert.ok(applyTask([], { type: 'system', subtype: 'task_started', task_id: 'b', description: 'bg', tool_use_id: 'toolu_b', is_backgrounded: true }, 0)[0].backgrounded)
})
