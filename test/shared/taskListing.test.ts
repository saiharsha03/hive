import { test } from 'vitest'
import assert from 'node:assert/strict'
import { shellName, worthListing, type Task } from '../../src/shared/taskCore'

const task = (over: Partial<Task>): Task => ({ id: 'x', kind: 'local_bash', title: 'npm test', status: 'running', startedAt: 0, phases: [], agents: [], ...over })

test('quick and finished shells are not background work; agents, workflows and Codex always are', () => {
  assert.equal(worthListing(task({}), 5_000), false)
  assert.equal(worthListing(task({}), 20_000), true)
  assert.equal(worthListing(task({ status: 'completed' }), 60_000), false)
  for (const kind of ['local_agent', 'local_workflow', 'codex']) assert.equal(worthListing(task({ kind, status: 'completed' }), 1), true)
})

test('a shell is named by its description when the chat has it', () => {
  const describe = (c: string) => (c === 'npm test' ? 'Run the unit tests' : undefined)
  assert.equal(shellName(task({}), describe), 'Run the unit tests')
  assert.equal(shellName(task({ title: 'ls' }), describe), 'ls')
  assert.equal(shellName(task({ kind: 'local_agent', title: 'Explore repo' }), describe), 'Explore repo')
})
