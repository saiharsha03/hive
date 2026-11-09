import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as m from '../../src/shared/modeCore'
test('modeFor: background is auto, foreground keeps its mode', () => {
  assert.equal(m.modeFor(true, 'bypassPermissions'), 'auto')
  assert.equal(m.modeFor(false, 'bypassPermissions'), 'bypassPermissions')
  assert.equal(m.modeFor(false, 'default'), 'default')
})
test('modeSwitch only asks for a change when the live mode differs', () => {
  assert.equal(m.modeSwitch('bypassPermissions', true, 'bypassPermissions'), 'auto')
  assert.equal(m.modeSwitch('auto', false, 'bypassPermissions'), 'bypassPermissions')
  assert.equal(m.modeSwitch('auto', true, 'bypassPermissions'), null)
  assert.equal(m.modeSwitch('bypassPermissions', false, 'bypassPermissions'), null)
})
test('modeLabel', () => {
  assert.equal(m.modeLabel('auto'), 'Auto mode')
  assert.equal(m.modeLabel('bypassPermissions'), 'Bypass permissions')
  assert.equal(m.modeLabel('something'), 'something')
})
