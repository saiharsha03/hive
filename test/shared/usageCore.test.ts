// a placeholder usage answer (5 h at 0, no reset time) is not a reading; anything with a 5 h window is
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { realLimits } from '../../src/shared/usageCore'

test('placeholder limits are not a reading', () => {
  assert.equal(realLimits({ five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 12, resets_at: '2026-11-07T08:00:00Z' } }), false)
  assert.equal(realLimits({ five_hour: { utilization: 37, resets_at: '2026-11-03T19:40:00Z' } }), true)
  assert.equal(realLimits({ five_hour: { utilization: 0, resets_at: '2026-11-03T19:40:00Z' } }), true) // a fresh window at 0
  assert.equal(realLimits({ five_hour: { utilization: 5, resets_at: null } }), true)
  assert.equal(realLimits(null), false)
  assert.equal(realLimits({}), false)
})
