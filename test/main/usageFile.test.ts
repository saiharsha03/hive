// the usage snapshot a usage-guard hook reads: same shape as the terminal plugin's, real readings only, once a minute
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const file = join(mkdtempSync(join(tmpdir(), 'hive-usage-')), 'usage', 'latest.json')
process.env.HIVE_USAGE_FILE = file
const { usageSnapshot, writeUsageFile } = await import('../../src/main/usageFile')
const T = Date.parse('2026-11-09T12:00:00Z')

test('one entry per window with a reading and a reset time, percent 0-100', () => {
  const s = usageSnapshot({
    five_hour: { utilization: 42, resets_at: '2026-11-09T15:00:00Z' },
    seven_day: { utilization: 31.4, resets_at: Date.parse('2026-11-12T08:00:00Z') / 1000 },
    seven_day_opus: { utilization: 90, resets_at: '2026-11-12T08:00:00Z' }, // not a kind the hook knows
  }, T)
  assert.deepEqual(s, { writtenAt: '2026-11-09T12:00:00.000Z', rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-09T15:00:00.000Z' },
    { kind: 'seven_day', percentUsed: 31, resetsAt: '2026-11-12T08:00:00.000Z' },
  ] })
  // a window with no reset time is left out
  assert.deepEqual(usageSnapshot({ five_hour: { utilization: 10, resets_at: null }, seven_day: { utilization: 5, resets_at: '2026-11-12T08:00:00Z' } }, T)!.rateLimits.map((r) => r.kind), ['seven_day'])
  assert.equal(usageSnapshot({ seven_day: { utilization: 120, resets_at: '2026-11-12T08:00:00Z' } }, T)!.rateLimits[0].percentUsed, 100)
})

test('a placeholder answer writes nothing', () => {
  assert.equal(usageSnapshot(null, T), null)
  assert.equal(usageSnapshot({ five_hour: { utilization: 0, resets_at: null } }, T), null) // the idle placeholder
})

test('written atomically at most once a minute, never in test mode', () => {
  const l = { five_hour: { utilization: 42, resets_at: '2026-11-09T15:00:00Z' } }
  assert.equal(writeUsageFile(l, T, { test: true }), false)
  assert.ok(!existsSync(file))
  assert.equal(writeUsageFile(l, T, { test: false }), true)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).rateLimits[0].percentUsed, 42)
  assert.equal(writeUsageFile({ five_hour: { utilization: 50, resets_at: '2026-11-09T15:00:00Z' } }, T + 30_000, { test: false }), false) // too soon
  assert.equal(writeUsageFile({ five_hour: { utilization: 50, resets_at: '2026-11-09T15:00:00Z' } }, T + 61_000, { test: false }), true)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).rateLimits[0].percentUsed, 50)
})
