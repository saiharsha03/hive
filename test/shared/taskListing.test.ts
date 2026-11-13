import { test } from 'vitest'
import assert from 'node:assert/strict'
import { elsewhereListed, inThreadList, isReviewTask, shellName, worthListing, type Task } from '../../src/shared/taskCore'

const task = (over: Partial<Task>): Task => ({ id: 'x', kind: 'local_bash', title: 'npm test', status: 'running', startedAt: 0, phases: [], agents: [], ...over })

test('quick and finished shells are not background work; agents, workflows and Codex always are', () => {
  assert.equal(worthListing(task({}), 5_000), false)
  assert.equal(worthListing(task({}), 20_000), true)
  assert.equal(worthListing(task({ status: 'completed' }), 60_000), false)
  for (const kind of ['local_agent', 'local_workflow', 'codex']) assert.equal(worthListing(task({ kind, status: 'completed' }), 1), true)
})

test('from other threads: running work that is worth listing, and agent work that failed within the hour; never a failed or quick shell', () => {
  const HOUR = 3_600_000
  const now = 10 * HOUR
  assert.equal(elsewhereListed(task({ status: 'failed', endedAt: now - 1000 }), now), false) // a shell that exited non-zero
  assert.equal(elsewhereListed(task({ status: 'completed', endedAt: now - 1000 }), now), false)
  assert.equal(elsewhereListed(task({ startedAt: now - 5_000 }), now), false)
  assert.equal(elsewhereListed(task({ startedAt: now - 20_000 }), now), true)
  assert.equal(elsewhereListed(task({ kind: 'local_agent', startedAt: now - 1000 }), now), true)
  for (const kind of ['local_agent', 'local_workflow', 'codex']) {
    assert.equal(elsewhereListed(task({ kind, status: 'failed', endedAt: now - HOUR + 1000 }), now), true)
    assert.equal(elsewhereListed(task({ kind, status: 'failed', endedAt: now - HOUR - 1000 }), now), false)
    assert.equal(elsewhereListed(task({ kind, status: 'completed', endedAt: now - 1000 }), now), false)
  }
  assert.equal(elsewhereListed(task({ kind: 'monitor', status: 'failed', endedAt: now - 1000 }), now), false)
})

test('a review is a Codex run or agent work whose name, title, type or prompt says so; never a shell or monitor', () => {
  assert.equal(isReviewTask(task({ kind: 'codex', title: 'Anything' })), true)
  assert.equal(isReviewTask(task({ kind: 'local_agent', title: 'Review the auth change' })), true)
  assert.equal(isReviewTask(task({ kind: 'local_agent', title: 'Explore repo' })), false)
  assert.equal(isReviewTask(task({ kind: 'local_agent', title: 'Explore repo' }), { type: 'security-scan' }), true)
  assert.equal(isReviewTask(task({ kind: 'local_agent', title: 'Explore repo' }), { prompt: `${'x'.repeat(400)} review` }), false) // only the start of the prompt
  assert.equal(isReviewTask(task({ title: 'npm run review' })), false)
  assert.equal(isReviewTask(task({ kind: 'monitor', title: 'audit log' })), false)
})

test('a shell is named by its description when the chat has it', () => {
  const describe = (c: string) => (c === 'npm test' ? 'Run the unit tests' : undefined)
  assert.equal(shellName(task({}), describe), 'Run the unit tests')
  assert.equal(shellName(task({ title: 'ls' }), describe), 'ls')
  assert.equal(shellName(task({ kind: 'local_agent', title: 'Explore repo' }), describe), 'Explore repo')
})

test('the thread lists drop finished work a minute after it ended', () => {
  const done = task({ kind: 'local_agent', status: 'completed', endedAt: 100_000 })
  assert.equal(inThreadList(done, 130_000), true)
  assert.equal(inThreadList(done, 161_000), false)
  assert.equal(inThreadList(task({ kind: 'local_agent' }), 999_999), true)
  assert.equal(inThreadList(task({ kind: 'local_agent', status: 'stopped' }), 1), false) // no end time: not shown
})
