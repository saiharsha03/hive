import { test } from 'vitest'
import assert from 'node:assert/strict'
import { isDue, lastSlot, needsReview, parseDependabotConfig, parsePrList, reviewPrompt } from '../../src/shared/dependabotCore'

test('dependabot schedule: noon daily, catch up at next start', () => {
  const at = (s: string) => new Date(s)
  assert.equal(lastSlot(at('2026-10-30T13:00:00'), '12:00').getTime(), at('2026-10-30T12:00:00').getTime())
  assert.equal(lastSlot(at('2026-10-30T11:59:00'), '12:00').getTime(), at('2026-10-29T12:00:00').getTime())
  assert.equal(isDue(at('2026-10-30T11:00:00'), at('2026-10-29T12:00:30').getTime(), '12:00'), false) // ran yesterday at noon
  assert.equal(isDue(at('2026-10-30T12:00:00'), at('2026-10-29T12:00:30').getTime(), '12:00'), true) // noon today
  assert.equal(isDue(at('2026-10-31T09:00:00'), at('2026-10-29T12:00:30').getTime(), '12:00'), true) // closed at noon on the 30th
  assert.equal(isDue(at('2026-10-30T15:00:00'), at('2026-10-30T12:01:00').getTime(), '12:00'), false)
  assert.equal(isDue(at('2026-10-30T15:00:00'), null, '12:00'), true)
})

test('dependabot config, pr list and which PRs need review', () => {
  const c = parseDependabotConfig({ HIVE_DEPENDABOT_REPOS: 'o/a, bad, o/b', HIVE_DEPENDABOT_TIME: '25:00' })
  assert.deepEqual(c.config!.repos, ['o/a', 'o/b'])
  assert.equal(c.config!.time, '12:00')
  assert.equal(c.problems.length, 2)
  assert.equal(parseDependabotConfig({}).config, null)
  const prs = parsePrList('o/a', JSON.stringify([{ number: 7, title: 'Bump x from 1 to 2', url: 'https://github.com/o/a/pull/7', headRefName: 'dependabot/npm/x', headRefOid: 'h1', updatedAt: 't' }]))
  assert.equal(prs[0].head, 'h1')
  assert.equal(needsReview(prs[0], {}), true)
  assert.equal(needsReview(prs[0], { 'o/a#7': { head: 'h1', at: 1, title: '' } }), false)
  assert.equal(needsReview(prs[0], { 'o/a#7': { head: 'h0', at: 1, title: '' } }), true) // Dependabot pushed again
  const p = reviewPrompt(prs[0], null)
  assert.ok(p.includes('Verdict: safe after') && p.includes('Do not merge'))
})
