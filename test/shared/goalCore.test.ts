import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { goalMarks, goalOnResume, goalReduce, parseGoalReply, type Goal } from '../../src/shared/goalCore'

test('goal: synthetic replies from the SDK log', () => {
  assert.deepEqual(parseGoalReply('Goal set: the file x exists and contains the word done'), { kind: 'set', condition: 'the file x exists and contains the word done' })
  assert.deepEqual(parseGoalReply('Goal cleared: the file x exists'), { kind: 'cleared', condition: 'the file x exists' })
  assert.deepEqual(parseGoalReply('No goal set. Usage: `/goal <condition>`'), { kind: 'none' })
  assert.deepEqual(parseGoalReply('Goal active: the file x (y) exists (not yet evaluated)'), { kind: 'active', condition: 'the file x (y) exists', note: 'not yet evaluated', full: 'the file x (y) exists (not yet evaluated)' })
  assert.deepEqual(parseGoalReply('Goal active: plain'), { kind: 'active', condition: 'plain', note: undefined })
  assert.equal(parseGoalReply('Goal set — creating the file now.'), null) // Claude's own words, not the reply
})
test('goal: goal_status tail from a real transcript (set, met, set, cleared)', () => {
  const lines = readFileSync(new URL('../fixtures/goal_marks.jsonl', import.meta.url), 'utf8').split('\n')
  const marks = goalMarks([...lines, '{"type":"user","message":{}}', 'not json', '{"type":"attachment","attachment":{"type":"goal_status"'])
  assert.equal(marks.length, 4)
  assert.deepEqual(marks.map((m) => [m.status.met, m.status.sentinel]), [[false, true], [true, false], [false, true], [true, true]])
  // replay: active -> met -> new active -> cleared
  let g: Goal | null = null
  const seen: (string | null)[] = []
  for (const mark of marks) { g = goalReduce(g, { t: 'mark', mark }); seen.push(g?.status ?? null) }
  assert.deepEqual(seen, ['active', 'met', 'active', null])
  // up to the met mark: met after 12.6s, with the evaluator's reason
  const met = marks.slice(0, 2).reduce<Goal | null>((p, mark) => goalReduce(p, { t: 'mark', mark }), null)!
  assert.equal(met.status, 'met')
  assert.equal(met.metAt! - met.setAt, 12568)
  assert.match(met.reason!, /File created successfully/)
  // resume: a goal met long ago is not shown; one still running is
  assert.equal(goalOnResume(marks.slice(0, 2)), null)
  assert.equal(goalOnResume(marks.slice(0, 3))?.status, 'active')
  assert.equal(goalOnResume(marks), null)
})
test('goal: our own start time survives the transcript marks and "Goal active"', () => {
  let g = goalReduce(null, { t: 'reply', reply: { kind: 'set', condition: 'c' }, now: 1000 })
  g = goalReduce(g, { t: 'mark', mark: { status: { met: false, sentinel: true, condition: 'c' }, at: 1200 } })
  assert.equal(g!.setAt, 1000)
  g = goalReduce(g, { t: 'mark', mark: { status: { met: false, condition: 'c', reason: 'not yet', iterations: 2 }, at: 5000 } })
  assert.deepEqual([g!.status, g!.setAt, g!.reason, g!.iterations], ['active', 1000, 'not yet', 2])
  g = goalReduce(g, { t: 'reply', reply: { kind: 'active', condition: 'c' }, now: 9000 })
  assert.equal(g!.setAt, 1000)
  // a late "cleared" mark for an older goal does not wipe the new one
  const other = goalReduce(g, { t: 'mark', mark: { status: { met: true, sentinel: true, condition: 'old' }, at: 9500 } })
  assert.equal(other?.condition, 'c')
  assert.equal(goalReduce(g, { t: 'reply', reply: { kind: 'cleared', condition: 'c' }, now: 9999 }), null)
  // passive active_goal (not sent by 0.3.314)
  assert.equal(goalReduce(g, { t: 'active_goal', value: null }), null)
  assert.equal(goalReduce(null, { t: 'active_goal', value: { condition: 'z', iterations: 1, set_at: 77, last_reason: 'r' } })!.setAt, 77)
})
