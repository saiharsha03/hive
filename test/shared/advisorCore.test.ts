import { test } from 'vitest'
import assert from 'node:assert/strict'
import { ADVISOR_DEFAULT, ADVISOR_OFF, advisorChecked, advisorItems, advisorModelOf, advisorNow, advisorWord, isAdvisorValue } from '../../src/shared/advisorCore'
import { emptyStatus, reduceStatus } from '../../src/shared/statusCore'

const label = (m: string) => (m === 'claude-fable-5-2' ? 'Fable 5.2' : m)
const models = [{ value: 'claude-fable-5-2', displayName: 'Fable 5.2' }, { value: 'haiku', displayName: 'Haiku' }]

test('the Advisor group: Off, Default with the Settings value, then the model list', () => {
  const items = advisorItems(models, 'claude-fable-5-2', label)
  assert.deepEqual(items.map((i) => i.label), ['Off', 'Default', 'Fable 5.2', 'Haiku'])
  assert.equal(items[1].note, 'Fable 5.2')
  assert.equal(advisorItems(models, '', label)[1].note, 'off')
  assert.ok(items.every((i) => isAdvisorValue(i.value)))
  assert.ok(!isAdvisorValue('haiku'))
  // a model whose id is "default" gets its own row, apart from the Default row
  const keys = advisorItems([{ value: 'default', displayName: 'Default (recommended)' }], '', label).map((i) => i.value)
  assert.equal(new Set(keys).size, keys.length)
})

test('a picked row sends the model, the Settings value or nothing', () => {
  assert.equal(advisorModelOf(ADVISOR_OFF, 'opus'), '')
  assert.equal(advisorModelOf(ADVISOR_DEFAULT, 'opus'), 'opus')
  assert.equal(advisorModelOf(ADVISOR_DEFAULT, ''), '')
  assert.equal(advisorModelOf('advisor:haiku', 'opus'), 'haiku')
})

test('before anything is picked or reported the thread follows the default', () => {
  assert.equal(advisorNow({}, ''), null)
  assert.equal(advisorChecked({}, ''), ADVISOR_DEFAULT)
  assert.equal(advisorWord({}, '', label), '')
  assert.equal(advisorWord({}, 'claude-fable-5-2', label), 'advisor Fable 5.2')
})

test('a pick shows at once; what main reports wins', () => {
  const picked = { advisorPick: 'advisor:haiku' }
  assert.equal(advisorChecked(picked, ''), 'advisor:haiku')
  assert.equal(advisorWord(picked, '', label), 'advisor haiku')
  assert.equal(advisorWord({ advisorPick: 'advisor:haiku', advisor: null }, '', label), '')
  assert.equal(advisorWord({ advisorPick: ADVISOR_OFF }, 'opus', label), '')
  // told by main without a pick (another window, the phone): the row follows the model
  assert.equal(advisorChecked({ advisor: 'haiku' }, 'opus'), 'advisor:haiku')
  assert.equal(advisorChecked({ advisor: null }, 'opus'), ADVISOR_OFF)
  assert.equal(advisorChecked({ advisor: 'opus' }, 'opus'), ADVISOR_DEFAULT)
})

test('the status reducer keeps hive_advisor', () => {
  let s = reduceStatus(emptyStatus(), { type: 'hive_advisor', model: 'haiku' }, 0)
  assert.equal(s.advisor, 'haiku')
  s = reduceStatus(s, { type: 'hive_advisor', model: null }, 0)
  assert.equal(s.advisor, null)
})
