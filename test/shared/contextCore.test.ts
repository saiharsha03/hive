import { test } from 'vitest'
import assert from 'node:assert/strict'
import { canCompact, contextPct, contextWarn, fastLabel, fastSupported, thinkingPreview } from '../../src/shared/contextCore'
import { emptyStatus, reduceStatus } from '../../src/shared/statusCore'

test('contextPct: share of the window, clamped; null without a window', () => {
  assert.equal(contextPct(50_000, 200_000), 25)
  assert.equal(contextPct(250_000, 200_000), 100)
  assert.equal(contextPct(10, 0), null)
  assert.equal(contextPct(NaN, 100), null)
})

test('contextWarn: only above 80%', () => {
  assert.equal(contextWarn(80), false)
  assert.equal(contextWarn(81), true)
  assert.equal(contextWarn(null), false)
})

test('canCompact: a live, idle, not-compacting thread only', () => {
  assert.equal(canCompact({ live: true, busy: false }), true)
  assert.equal(canCompact({ live: true, busy: true }), false)
  assert.equal(canCompact({ live: false, busy: false }), false)
  assert.equal(canCompact({ live: true, busy: false, compacting: true }), false)
})

test('fastLabel: off, on, cooling down, refused with why', () => {
  assert.equal(fastLabel(false, 'on'), 'fast off')
  assert.equal(fastLabel(true), 'fast')
  assert.equal(fastLabel(true, 'cooldown'), 'fast, cooling down')
  assert.equal(fastLabel(true, 'off', 'model_not_allowed'), 'fast: not available for this model')
  assert.equal(fastLabel(true, 'off', 'sdk_opt_in_required'), 'fast')
  assert.equal(fastLabel(true, 'off', 'something_new'), 'fast: something_new')
})

test('fastSupported: from the model list, null when unknown', () => {
  const models = [{ value: 'default' }, { value: 'opus', supportsFastMode: true }, { value: 'haiku', supportsFastMode: false }]
  assert.equal(fastSupported(models, 'opus'), true)
  assert.equal(fastSupported(models, 'claude-haiku-5-5'), false)
  assert.equal(fastSupported(models, 'claude-sonnet-5-5'), null)
  assert.equal(fastSupported(null, 'opus'), null)
})

test('thinkingPreview: first line with words, cut short', () => {
  assert.equal(thinkingPreview('\n\n**Plan**: read the file\nthen edit'), 'Plan: read the file')
  assert.equal(thinkingPreview('x'.repeat(100), 10), `${'x'.repeat(9)}…`)
  assert.equal(thinkingPreview(''), '')
  assert.equal(thinkingPreview('## Call `create_invoice` with __the__ key > old_key'), 'Call create_invoice with the key > old_key')
})

test('reduceStatus: fast on/off from Orbit, state and refusal from the result', () => {
  let st = reduceStatus(emptyStatus(), { type: 'hive_fast', on: true }, 0)
  assert.equal(st.fast, true)
  st = reduceStatus(st, { type: 'result', fast_mode_state: 'off', fast_mode_disabled_reason: 'model_not_allowed' }, 0)
  assert.equal(st.fastState, 'off')
  assert.equal(st.fastReason, 'model_not_allowed')
  st = reduceStatus(st, { type: 'hive_fast', on: false, error: 'nope' }, 0)
  assert.equal(st.fast, false)
  assert.equal(st.fastError, 'nope')
  assert.equal(st.fastReason, undefined)
})
