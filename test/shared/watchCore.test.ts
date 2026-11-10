import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  dueKind, lastWeeklySlot, markStarted, nextRuns, parseEvery, parseFindings, parseWeekly,
  type WatchConfig, type WatchState,
} from '../../src/shared/watchCore'

const H = 3_600_000
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)
// Sat 2026-10-31; Mondays 2026-10-26 and 2026-11-02
const cfg: WatchConfig = { dir: 'C:/w', prompt: 'C:/w/watch.md', cwd: '', everyMs: H, tiers: null, daily: '08:00', weekly: { day: 1, time: '08:00' } }
const st = (p: Partial<WatchState['last']> = {}, since: number | null = null, enabled = true): WatchState =>
  ({ enabled, since, last: { sweep: null, daily: null, weekly: null, ...p } })

test('interval and weekly parsing', () => {
  assert.equal(parseEvery('60m'), H)
  assert.equal(parseEvery('2h'), 2 * H)
  assert.equal(parseEvery('off'), null)
  assert.equal(parseEvery('soon'), undefined)
  assert.deepEqual(parseWeekly('Monday 08:30'), { day: 1, time: '08:30' })
  assert.equal(parseWeekly('Funday 08:00'), null)
})

test('first ever tick: a sweep, no report (nothing was missed yet)', () => {
  assert.equal(dueKind(at(2026, 10, 31, 12), cfg, st(), false), 'sweep')
})

test('next sweep after the interval, not before', () => {
  const s = markStarted(st(), 'sweep', at(2026, 10, 31, 12).getTime())
  assert.equal(s.since, at(2026, 10, 31, 12).getTime())
  assert.equal(dueKind(at(2026, 10, 31, 12, 59), cfg, s, false), null)
  assert.equal(dueKind(at(2026, 10, 31, 13), cfg, s, false), 'sweep')
  assert.equal(nextRuns(at(2026, 10, 31, 12, 30), cfg, s).sweep, at(2026, 10, 31, 13).getTime())
})

test('daily slot: due once after it passes, then not until tomorrow', () => {
  const s = markStarted(st(), 'sweep', at(2026, 10, 31, 7, 30).getTime())
  assert.equal(dueKind(at(2026, 10, 31, 7, 59), cfg, s, false), null)
  assert.equal(dueKind(at(2026, 10, 31, 8, 0), cfg, s, false), 'daily')
  const d = markStarted(s, 'daily', at(2026, 10, 31, 8, 0).getTime())
  assert.equal(d.last.sweep, at(2026, 10, 31, 8).getTime()) // a daily run stands in for a sweep
  assert.equal(dueKind(at(2026, 10, 31, 8, 30), cfg, d, false), null)
  assert.equal(nextRuns(at(2026, 10, 31, 8, 30), cfg, d).daily, at(2026, 11, 1, 8).getTime())
})

test('weekly slot wins over daily when both are due and covers the daily', () => {
  const s = markStarted(st(), 'sweep', at(2026, 11, 2, 7).getTime()) // Mon 07:00
  assert.equal(dueKind(at(2026, 11, 2, 8, 1), cfg, s, false), 'weekly')
  const w = markStarted(s, 'weekly', at(2026, 11, 2, 8, 1).getTime())
  assert.equal(dueKind(at(2026, 11, 2, 8, 2), cfg, w, false), null) // no second (daily) run
  assert.equal(nextRuns(at(2026, 11, 2, 9), cfg, w).weekly, at(2026, 11, 9, 8).getTime())
  assert.equal(lastWeeklySlot(at(2026, 10, 31, 12), 1, '08:00').getTime(), at(2026, 10, 26, 8).getTime())
  assert.equal(lastWeeklySlot(at(2026, 11, 2, 7), 1, '08:00').getTime(), at(2026, 10, 26, 8).getTime())
  assert.equal(lastWeeklySlot(at(2026, 11, 2, 8), 1, '08:00').getTime(), at(2026, 11, 2, 8).getTime())
})

test('catch-up: closed over several days, one report run at start, not one per missed slot', () => {
  const s = markStarted(st(), 'daily', at(2026, 10, 27, 8).getTime()) // last ran Tue 10-27
  const now = at(2026, 10, 31, 12) // back Saturday
  assert.equal(dueKind(now, cfg, s, false), 'daily')
  assert.equal(nextRuns(now, cfg, s).daily, now.getTime())
  const after = markStarted(s, 'daily', now.getTime())
  assert.equal(dueKind(at(2026, 10, 31, 12, 5), cfg, after, false), null)
  // Monday's weekly was missed too: the weekly runs, once
  const w = markStarted(st(), 'sweep', at(2026, 10, 20).getTime())
  assert.equal(dueKind(now, cfg, w, false), 'weekly')
  assert.equal(dueKind(at(2026, 10, 31, 12, 1), cfg, markStarted(w, 'weekly', now.getTime()), false), null)
})

test('no overlap: nothing starts while the previous run works; off means off', () => {
  const s = st({ sweep: at(2026, 10, 30).getTime() }, at(2026, 10, 1).getTime())
  assert.equal(dueKind(at(2026, 10, 31, 12), cfg, s, true), null)
  assert.notEqual(dueKind(at(2026, 10, 31, 12), cfg, s, false), null)
  assert.equal(dueKind(at(2026, 10, 31, 12), cfg, { ...s, enabled: false }, false), null)
})

test('sweeps off, reports only', () => {
  const c = { ...cfg, everyMs: null, weekly: null }
  const s = st({}, at(2026, 10, 31, 7).getTime())
  assert.equal(dueKind(at(2026, 10, 31, 7, 30), c, s, false), null)
  assert.equal(dueKind(at(2026, 10, 31, 8), c, s, false), 'daily')
  assert.equal(nextRuns(at(2026, 10, 31, 7, 30), c, s).sweep, null)
})

test('findings: newest first, bad lines skipped', () => {
  const f = parseFindings('{"at":"2026-10-31T10:00:00","title":"a","why":"w","kind":"good"}\nnot json\n{"title":"b"}\n')
  assert.deepEqual(f.map((x) => x.title), ['b', 'a'])
  assert.equal(f[1].kind, 'good')
})
