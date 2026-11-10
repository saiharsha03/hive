// a placeholder usage answer (5 h at 0, no reset time, no weekly reset time) is not a reading; anything with a 5 h
// window is, and so is a weekly window with a reset time while the 5 h one is idle
import { describe, expect, it, test } from 'vitest'
import assert from 'node:assert/strict'
import { realLimits, usageRows } from '../../src/shared/usageCore'

test('placeholder limits are not a reading', () => {
  assert.equal(realLimits({ five_hour: { utilization: 0, resets_at: null } }), false)
  assert.equal(realLimits({ five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 12, resets_at: null } }), false)
  // between sessions the 5-hour window is idle (0, no reset) but the weekly number is real: adaptive watchers need it
  assert.equal(realLimits({ five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 12, resets_at: '2026-11-07T08:00:00Z' } }), true)
  assert.equal(realLimits({ five_hour: { utilization: 0, resets_at: null }, seven_day_opus: { utilization: 3, resets_at: '2026-11-07T08:00:00Z' } }), true)
  assert.equal(realLimits({ five_hour: { utilization: 37, resets_at: '2026-11-03T19:40:00Z' } }), true)
  assert.equal(realLimits({ five_hour: { utilization: 0, resets_at: '2026-11-03T19:40:00Z' } }), true) // a fresh window at 0
  assert.equal(realLimits({ five_hour: { utilization: 5, resets_at: null } }), true)
  assert.equal(realLimits(null), false)
  assert.equal(realLimits({}), false)
  // no 5-hour window: a weekly reading with a reset time counts, one without does not
  assert.equal(realLimits({ five_hour: null, seven_day: { utilization: 22, resets_at: '2026-11-07T08:00:00Z' } }), true)
  assert.equal(realLimits({ seven_day: { utilization: 22, resets_at: null } }), false)
})

describe('usageRows', () => {
  it('lists the windows with a reading in /usage order', () => {
    const rows = usageRows({ seven_day_opus: { utilization: 5, resets_at: null }, seven_day: { utilization: 40, resets_at: 'b' }, five_hour: { utilization: 12, resets_at: 'a' }, seven_day_sonnet: null })
    expect(rows.map((r) => [r.key, r.pct, r.resetsAt])).toEqual([['five_hour', 12, 'a'], ['seven_day', 40, 'b'], ['seven_day_opus', 5, null]])
  })
  it('shows a window whose reset time has passed as 0, not the old number', () => {
    const now = Date.parse('2026-11-05T13:00:00Z')
    const rows = usageRows({ five_hour: { utilization: 32, resets_at: '2026-11-04T17:00:00Z' }, seven_day: { utilization: 26, resets_at: '2026-11-07T08:00:00Z' } }, now)
    expect(rows.map((r) => [r.key, r.pct, r.resetsAt])).toEqual([['five_hour', 0, null], ['seven_day', 26, '2026-11-07T08:00:00Z']])
  })
  it('gives nothing for a placeholder answer or none', () => {
    expect(usageRows({ five_hour: { utilization: 0, resets_at: null } })).toEqual([])
    expect(usageRows(null)).toEqual([])
  })
  it('lists an idle 5-hour window at 0 beside a real weekly reading', () => {
    const rows = usageRows({ five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 12, resets_at: '2026-11-07T08:00:00Z' } }, Date.parse('2026-11-05T13:00:00Z'))
    expect(rows.map((r) => [r.key, r.pct])).toEqual([['five_hour', 0], ['seven_day', 12]])
  })
})
