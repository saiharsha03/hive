// a branch's pull request checks, and the message that asks a thread to ship its branch
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { checksText, parsePrView, protectedBranch, prViewError, shipPrompt, summarizeChecks } from '../../src/shared/ciCore'

const run = (status: string, conclusion = '') => ({ __typename: 'CheckRun', name: 'x', status, conclusion })
const ctx = (state: string) => ({ __typename: 'StatusContext', context: 'y', state })

test('no rollup or an empty one is none', () => {
  assert.deepEqual(summarizeChecks([]), { state: 'none', passed: 0, failed: 0, pending: 0, total: 0 })
  assert.equal(summarizeChecks(null).state, 'none')
})

test('check runs and status contexts both count; skipped and neutral pass', () => {
  const c = summarizeChecks([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'), run('COMPLETED', 'NEUTRAL'), ctx('SUCCESS')])
  assert.deepEqual(c, { state: 'passing', passed: 4, failed: 0, pending: 0, total: 4 })
})

test('a failure beats pending; cancelled, timed out and action required fail', () => {
  assert.equal(summarizeChecks([run('IN_PROGRESS'), run('COMPLETED', 'FAILURE')]).state, 'failing')
  for (const x of ['CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']) assert.equal(summarizeChecks([run('COMPLETED', x)]).failed, 1)
  assert.equal(summarizeChecks([ctx('ERROR')]).state, 'failing')
  const p = summarizeChecks([run('QUEUED'), ctx('PENDING'), run('COMPLETED', 'SUCCESS')])
  assert.deepEqual(p, { state: 'pending', passed: 1, failed: 0, pending: 2, total: 3 })
})

test('the counts read plainly', () => {
  assert.equal(checksText({ state: 'failing', passed: 3, failed: 1, pending: 1, total: 5 }), '3 of 5 passed, 1 failed, 1 running')
  assert.equal(checksText({ state: 'passing', passed: 2, failed: 0, pending: 0, total: 2 }), '2 of 2 passed')
  assert.equal(checksText(summarizeChecks([])), 'no checks')
})

test('gh pr view output parses; no PR is null, anything else is unavailable', () => {
  const pr = parsePrView(JSON.stringify({ number: 90, url: 'https://github.com/o/r/pull/90', state: 'OPEN', isDraft: false, title: 't', statusCheckRollup: [ctx('SUCCESS')] }))
  assert.equal(pr.number, 90)
  assert.equal(pr.checks.state, 'passing')
  assert.equal(prViewError('no pull requests found for branch "x"'), null)
  assert.deepEqual(prViewError('To get started with GitHub CLI, please run:  gh auth login\nmore'), { unavailable: 'To get started with GitHub CLI, please run:  gh auth login' })
  assert.deepEqual(prViewError('spawn gh ENOENT'), { unavailable: 'gh (the GitHub CLI) is not installed' })
})

test('protected branches', () => {
  for (const b of ['main', 'master', 'prod', 'production', 'release/1.2']) assert.ok(protectedBranch(b), b)
  for (const b of ['hive-next', 'mainline', 'feature/release', null]) assert.ok(!protectedBranch(b), String(b))
})

test('the ship message asks for a ready PR, never a draft, and names the branch', () => {
  const noDraft = (s: string) => !s.replace(/not a draft/g, '').toLowerCase().includes('draft')
  const fresh = shipPrompt({ branch: 'hive-next', upstream: 'origin/hive-next', ahead: 2, files: 3 })
  assert.ok(fresh.includes('ready for review'))
  assert.ok(noDraft(fresh))
  assert.ok(fresh.includes('hive-next'))
  assert.ok(fresh.includes('no attribution lines'))
  assert.ok(fresh.includes('2 commits ahead of origin/hive-next'))
  assert.ok(shipPrompt({ branch: 'b', upstream: null, ahead: 0, files: 1 }).includes('no upstream yet'))
  const update = shipPrompt({ branch: 'b', upstream: 'origin/b', ahead: 1, files: 0, pr: { number: 90 } })
  assert.ok(update.includes('#90') && update.includes('do not open another') && update.includes('ready for review'))
  assert.ok(noDraft(update))
})
