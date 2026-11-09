import { test } from 'vitest'
import assert from 'node:assert/strict'
import { describeCron, nextRun, parseCron, untilText } from '../../src/shared/cronCore'

const at = (s: string) => new Date(s) // local time

test('cron: every minute / every 5', () => {
  assert.deepEqual(nextRun('*/1 * * * *', at('2026-10-31T12:00:30')), at('2026-10-31T12:01:00'))
  assert.deepEqual(nextRun('* * * * *', at('2026-10-31T12:00:00')), at('2026-10-31T12:01:00'))
  assert.deepEqual(nextRun('*/5 * * * *', at('2026-10-31T12:03:10')), at('2026-10-31T12:05:00'))
  assert.deepEqual(nextRun('*/5 * * * *', at('2026-10-31T23:58:00')), at('2026-11-01T00:00:00'))
})
test('cron: weekdays, month ends, lists, steps from a start', () => {
  // 2026-10-30 is a Friday
  assert.deepEqual(nextRun('0 9 * * 1-5', at('2026-10-30T10:00:00')), at('2026-11-02T09:00:00'))
  assert.deepEqual(nextRun('0 9 * * 1-5', at('2026-10-30T08:59:00')), at('2026-10-30T09:00:00'))
  assert.deepEqual(nextRun('30 14 31 * *', at('2026-11-05T00:00:00')), at('2026-12-31T14:30:00'))
  assert.deepEqual(nextRun('0 0 29 2 *', at('2026-03-01T00:00:00')), at('2028-02-29T00:00:00'))
  assert.deepEqual(nextRun('15,45 * * * *', at('2026-10-31T12:20:00')), at('2026-10-31T12:45:00'))
  assert.deepEqual(nextRun('5/20 * * * *', at('2026-10-31T12:26:00')), at('2026-10-31T12:45:00'))
  assert.deepEqual(nextRun('0 12 * * 7', at('2026-10-31T13:00:00')), at('2026-11-01T12:00:00')) // 7 = Sunday
})
test('cron: day-of-month OR day-of-week when both are set', () => {
  // the 1st of the month, or any Monday: from Fri Oct 30 the next is Sun Nov 1
  assert.deepEqual(nextRun('0 8 1 * 1', at('2026-10-30T12:00:00')), at('2026-11-01T08:00:00'))
})
test('cron: one-shot and invalid', () => {
  assert.deepEqual(nextRun('15 10 31 10 *', at('2026-10-31T09:00:00')), at('2026-10-31T10:15:00'))
  assert.equal(nextRun('15 10 31 10 *', at('2026-10-31T10:15:00'))!.getFullYear(), 2027)
  assert.equal(nextRun('61 * * * *', new Date()), null)
  assert.equal(nextRun('* * *', new Date()), null)
  assert.equal(nextRun('0 0 31 2 *', new Date()), null) // never
  assert.equal(parseCron('a b c d e'), null)
})
test('cron: labels and countdowns', () => {
  assert.equal(describeCron('*/1 * * * *'), 'every minute')
  assert.equal(describeCron('* * * * *'), 'every minute')
  assert.equal(describeCron('*/10 * * * *'), 'every 10m')
  assert.equal(describeCron('15 * * * *'), 'hourly at :15')
  assert.equal(describeCron('0 */2 * * *'), 'every 2h')
  assert.equal(describeCron('5 9 * * *'), 'daily at 9:05')
  assert.equal(describeCron('0 9 * * 1-5'), '0 9 * * 1-5')
  assert.equal(untilText(45_000), '45s')
  assert.equal(untilText(190_000), '3m 10s')
  assert.equal(untilText(2 * 3600_000 + 5 * 60_000), '2h 5m')
  assert.equal(untilText(-5), '0s')
})
