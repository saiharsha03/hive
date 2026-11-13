import { test } from 'vitest'
import assert from 'node:assert/strict'
import { ADVISOR_DEFAULT, ADVISOR_OFF, advisorAllowed, advisorChecked, advisorItems, advisorModelOf, advisorNow, advisorWord, isAdvisorValue, latestPerClass } from '../../src/shared/advisorCore'
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

test('a thread is offered only advisors above its own model; Fable, the top, may ask Fable', () => {
  const all = [{ value: 'haiku', displayName: 'Haiku' }, { value: 'sonnet', displayName: 'Sonnet' }, { value: 'claude-opus-5-5', displayName: 'Opus' }, { value: 'claude-fable-5-2', displayName: 'Fable' }]
  const offered = (thread: string) => advisorItems(all, '', (m) => m, thread).slice(2).map((i) => i.label)
  assert.deepEqual(offered('haiku'), ['Sonnet', 'Opus', 'Fable'])
  assert.deepEqual(offered('claude-sonnet-5-5'), ['Opus', 'Fable'])
  assert.deepEqual(offered('opus'), ['Fable'])
  assert.deepEqual(offered('claude-fable-5-2'), ['Fable'])
  assert.deepEqual(offered(''), ['Haiku', 'Sonnet', 'Opus', 'Fable']) // model not known yet: nothing held back
  assert.equal(advisorAllowed('sonnet', 'some-new-model'), true) // an unknown family is never held back
  // Off and Default always stay; a Default below the thread's model says so
  const items = advisorItems(all, 'sonnet', (m) => m, 'claude-fable-5-2')
  assert.deepEqual(items.slice(0, 2).map((i) => i.label), ['Off', 'Default'])
  assert.match(items[1].note ?? '', /not above this thread's model/)
})

test('the pickers keep only the newest model of each class', () => {
  const m = (value: string, displayName = value) => ({ value, displayName })
  const list = [m('default', 'Default'), m('claude-fable-5-2', 'Fable 5.2'), m('claude-fable-5-1', 'Fable 5.1'), m('claude-opus-5-5', 'Opus 5.5'), m('claude-opus-4-7', 'Opus 4.7'),
    m('claude-sonnet-5-5', 'Sonnet 5.5'), m('claude-sonnet-5-5[1m]', 'Sonnet 5.5 (1M context)'), m('claude-sonnet-4-6[1m]', 'Sonnet 4.6 (1M context)'), m('claude-haiku-5-5', 'Haiku 5.5'), m('claude-haiku-4-5', 'Haiku 4.5'), m('opus', 'Opus'), m('some-new-model', 'New')]
  const kept = (keep = '') => latestPerClass(list, keep).map((x) => x.value)
  assert.deepEqual(kept(), ['default', 'claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5[1m]', 'claude-haiku-5-5', 'opus', 'some-new-model'])
  // the model the thread runs on is never hidden, however old
  assert.ok(kept('claude-opus-4-7').includes('claude-opus-4-7'))
  // a class with one version keeps it; an empty list stays empty
  assert.deepEqual(latestPerClass([m('claude-opus-4-7', 'Opus 4.7')]).map((x) => x.value), ['claude-opus-4-7'])
  assert.deepEqual(latestPerClass([]), [])
})

test('a model class that does not exist yet is trimmed to its newest like the rest; Mythos ranks with Fable', () => {
  const m = (value: string, displayName = value) => ({ value, displayName })
  const list = [m('claude-mythos-5-2', 'Mythos 5.2'), m('claude-mythos-5-1', 'Mythos 5.1'), m('claude-nova-2-0', 'Nova 2'), m('claude-nova-1-9', 'Nova 1.9'), m('claude-fable-5-2', 'Fable 5.2')]
  assert.deepEqual(latestPerClass(list).map((x) => x.value), ['claude-mythos-5-2', 'claude-nova-2-0', 'claude-fable-5-2'])
  const offered = (thread: string) => advisorItems(latestPerClass(list), '', (x) => x, thread).slice(2).map((i) => i.label)
  assert.deepEqual(offered('claude-opus-5-5'), ['Mythos 5.2', 'Nova 2', 'Fable 5.2']) // above Opus, plus the unranked class
  assert.deepEqual(offered('claude-mythos-5-2'), ['Mythos 5.2', 'Nova 2', 'Fable 5.2']) // the top tier may ask the top tier
  assert.equal(advisorAllowed('claude-mythos-5-2', 'claude-opus-5-5'), false)
})
