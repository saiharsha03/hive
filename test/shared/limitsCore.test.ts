import { test } from 'vitest'
import assert from 'node:assert/strict'
import { gaugeOf, limitName, windowMs } from '../../src/shared/limitsCore'

const NOW = new Date('2026-11-12T12:00:00').getTime()
const HOUR = 3_600_000
const row = (key: string, pct: number, resetsInHours: number | null, label = key) => ({ key, label, pct, resetsAt: resetsInHours === null ? null : new Date(NOW + resetsInHours * HOUR).toISOString() })

test('a gauge says how much is used, how much of the window has passed, and whether that is ahead of the clock', () => {
  assert.equal(windowMs('five_hour'), 5 * HOUR)
  assert.equal(windowMs('seven_day_opus'), 7 * 24 * HOUR)
  // 5-hour window with 2.5 hours left: half the time gone
  const under = gaugeOf(row('five_hour', 38, 2.5), NOW)
  assert.equal(Math.round(under.passed!), 50)
  assert.equal(under.ahead, false)
  assert.match(under.says, /^5-hour: 38% used, resets today .*, 50% of the window gone: under pace$/)
  // 7-day window, 61% used with half the week gone: ahead
  const ahead = gaugeOf(row('seven_day', 61, 3.5 * 24), NOW)
  assert.equal(Math.round(ahead.passed!), 50)
  assert.equal(ahead.ahead, true)
  assert.match(ahead.says, /ahead of pace$/)
  // nearly out is a warning whatever the clock says; a sliver over the clock is not
  assert.equal(gaugeOf(row('five_hour', 95, 0.1), NOW).ahead, true)
  assert.equal(gaugeOf(row('five_hour', 53, 2.5), NOW).ahead, false)
})

test('a window with no reset time, or one already past, has no tick; the names read as the plan calls them', () => {
  assert.equal(gaugeOf(row('five_hour', 20, null), NOW).passed, null)
  assert.equal(gaugeOf(row('five_hour', 20, -1), NOW).passed, null)
  assert.equal(gaugeOf(row('five_hour', 140, 1), NOW).used, 100) // never drawn past full
  assert.equal(limitName(row('five_hour', 1, 1)), '5-hour')
  assert.deepEqual([row('five_hour', 1, 1), row('seven_day', 1, 1), row('seven_day_fable', 1, 1, 'Weekly (Fable)')].map((r) => gaugeOf(r, NOW).short), ['5h', '7d', 'Fa'])
  assert.equal(limitName(row('seven_day', 1, 1)), '7-day')
  assert.equal(limitName(row('seven_day_fable', 1, 1, 'Weekly (Fable)')), '7-day Fable')
})
