import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { Task } from '../../src/shared/taskCore'
import { asMonitors, barTasks, groupName, nextShellDue, rowType, runningLabel, taskDetail } from '../../src/shared/runningBarCore'

const NOW = 1_000_000
const task = (over: Partial<Task>): Task => ({ id: over.kind ?? 'x', kind: 'local_agent', title: 'Explore the repo', status: 'running', startedAt: NOW - 60_000, phases: [], agents: [], ...over })
const ids = (ts: Task[]) => ts.map((t) => t.id)

test('the bar lists running agents, workflows, Codex runs, monitors and shells past 15 seconds; never a quick or a finished shell', () => {
  const quick = task({ id: 'quick', kind: 'local_bash', startedAt: NOW - 5_000 })
  const slow = task({ id: 'slow', kind: 'local_bash', startedAt: NOW - 20_000 })
  const ended = task({ id: 'ended', kind: 'local_bash', status: 'completed', startedAt: NOW - 90_000, endedAt: NOW - 1_000 })
  const monitor = task({ id: 'mon', kind: 'local_monitor' })
  assert.deepEqual(ids(barTasks([quick], NOW)), [])
  assert.equal(runningLabel(barTasks([quick, ended], NOW)).total, 0)
  assert.deepEqual(ids(barTasks([quick, slow, ended, monitor], NOW)), ['slow', 'mon'])
  assert.equal(runningLabel(barTasks([slow], NOW)).text, '1 shell running')
  assert.equal(runningLabel(barTasks([monitor], NOW)).text, '1 monitor running')
  assert.equal(nextShellDue([quick, slow, monitor], NOW), NOW + 10_000) // the one render the closed bar asks for
  assert.equal(nextShellDue([slow], NOW), null)
})

test('an agent that just ended stays listed for a minute; a monitor that ended does not', () => {
  const done = task({ id: 'done', status: 'completed', endedAt: NOW - 10_000 })
  const old = task({ id: 'old', status: 'failed', endedAt: NOW - 61_000 })
  const mon = task({ id: 'mon', kind: 'local_monitor', status: 'stopped', endedAt: NOW - 1_000 })
  assert.deepEqual(ids(barTasks([done, old, mon], NOW)), ['done'])
  assert.deepEqual(runningLabel(barTasks([done], NOW)), { total: 0, text: 'Nothing running' }) // listed, but not counted
})

test('rows are grouped: agents and workflows, then shells, then monitors', () => {
  const all = [task({ id: 'm', kind: 'local_monitor' }), task({ id: 's', kind: 'local_bash' }), task({ id: 'w', kind: 'local_workflow' }), task({ id: 'a' }), task({ id: 'c', kind: 'codex' })]
  const listed = barTasks(all, NOW)
  assert.deepEqual(ids(listed), ['w', 'a', 'c', 's', 'm'])
  assert.deepEqual([...new Set(listed.map(groupName))], ['Subagents and workflows', 'Shells', 'Monitors'])
})

test('the resting label: none, one, several, mixed kinds, and all four', () => {
  const a = (id: string) => task({ id })
  assert.deepEqual(runningLabel([]), { total: 0, text: 'Nothing running' })
  assert.deepEqual(runningLabel([a('1')]), { total: 1, text: '1 subagent running' })
  assert.deepEqual(runningLabel([a('1'), a('2'), task({ id: '3', kind: 'codex' })]), { total: 3, text: '3 subagents running' }) // Codex counts with them
  assert.equal(runningLabel([a('1'), task({ kind: 'local_workflow' })]).text, '1 subagent and 1 workflow running')
  assert.equal(runningLabel([a('1'), a('2'), task({ kind: 'local_bash' }), task({ kind: 'local_monitor' })]).text, '2 subagents, 1 shell and 1 monitor running')
  assert.deepEqual(runningLabel([a('1'), a('2'), task({ kind: 'local_workflow' }), task({ kind: 'local_bash' }), task({ kind: 'local_monitor' })]),
    { total: 5, text: '5 running: 2 subagents, 1 workflow, 1 shell, 1 monitor' })
})

test('taskDetail reads the type, model and prompt from the tool call that started the task', () => {
  const items = [
    { kind: 'user', text: 'go' },
    { kind: 'tool', id: 'tu_1', name: 'Agent', input: { subagent_type: 'Explore', model: 'haiku', prompt: 'Find every caller\nof send()' } },
    { kind: 'tool', id: 'tu_2', name: 'Bash', input: { command: 'npm run watch', description: 'Watch the build' } },
    { kind: 'codex', id: 'c1', task: 'Review the diff', model: 'gpt-5', allowEdits: false },
  ]
  assert.deepEqual(taskDetail(items, task({ toolUseId: 'tu_1' })), { type: 'Explore', model: 'haiku', prompt: 'Find every caller\nof send()' })
  assert.deepEqual(taskDetail(items, task({ kind: 'local_bash', title: 'npm run watch', toolUseId: 'tu_2' })), { type: '', model: '', prompt: 'npm run watch' })
  assert.deepEqual(taskDetail(items, task({ id: 'codex:c1', kind: 'codex', title: 'Codex' })), { type: 'read only', model: 'gpt-5', prompt: 'Review the diff' })
  assert.equal(taskDetail(items, task({ toolUseId: 'tu_9' })), undefined)
  assert.equal(taskDetail(items, task({})), undefined) // no tool call known: never the first tool row
})

test('a row names its type: the subagent type, the workflow name, Codex, Shell, Monitor', () => {
  assert.equal(rowType(task({ name: 'general-purpose' }), { type: 'Explore', model: '', prompt: '' }), 'Explore')
  assert.equal(rowType(task({ name: 'general-purpose' })), 'general-purpose')
  assert.equal(rowType(task({})), 'Subagent')
  assert.equal(rowType(task({ kind: 'local_workflow', name: 'spec' }), { type: 'ignored', model: '', prompt: '' }), 'spec')
  assert.equal(rowType(task({ kind: 'codex', name: 'gpt-5' }), { type: 'read only', model: 'gpt-5', prompt: '' }), 'Codex')
  assert.equal(rowType(task({ kind: 'local_bash' }), { type: '', model: '', prompt: 'ls' }), 'Shell')
  assert.equal(rowType(task({ kind: 'local_monitor' })), 'Monitor')
})

test('a shell started in the background is listed from its first second; a monitor is known by the tool that started it', () => {
  const young = task({ id: 'bg', kind: 'local_bash', startedAt: NOW - 2_000, backgrounded: true })
  const fore = task({ id: 'fg', kind: 'local_bash', startedAt: NOW - 2_000 })
  assert.deepEqual(ids(barTasks([young, fore], NOW)), ['bg'])
  // the engine called the monitor's command a shell: the Monitor tool call makes it a monitor
  const mon = task({ id: 'm', kind: 'local_bash', startedAt: NOW - 2_000, backgrounded: true, toolUseId: 'tu1' })
  const items = [{ kind: 'tool', id: 'tu1', name: 'Monitor' }, { kind: 'tool', id: 'tu2', name: 'Bash' }]
  const seen = asMonitors(items, [mon, task({ id: 's', kind: 'local_bash', toolUseId: 'tu2' })])
  assert.deepEqual(seen.map((x) => x.kind), ['monitor', 'local_bash'])
  assert.equal(runningLabel(barTasks(seen, NOW)).text, '1 shell and 1 monitor running')
  assert.equal(asMonitors([], [mon])[0].kind, 'local_bash') // no Monitor call: left as it is
})
