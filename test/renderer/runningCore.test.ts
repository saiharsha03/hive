// the Running page's rows and trail, the schedule rows and the 24-hour strip's placement
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { cronPeriod, kindLabel, layoutStrip, nowNote, nowRows, relWord, scheduleRows, ticksOf, trail, type RunRow, type TaskLike } from '../../src/renderer/src/pages/runningCore'

const T0 = new Date(2026, 10, 9, 13, 27, 0).getTime()
const MIN = 60_000
const task = (id: string, over: Partial<TaskLike> = {}): TaskLike => ({ id, kind: 'local_agent', title: id, status: 'running', startedAt: T0 - 5 * MIN, ...over })
const row = (t: TaskLike): RunRow => ({ tabId: 'a', thread: 'Fix invoice numbers', task: t })

test('kinds read as words', () => {
  assert.equal(kindLabel('local_bash'), 'Shell')
  assert.equal(kindLabel('codex'), 'Codex')
  assert.equal(kindLabel('local_thing'), 'Thing')
})

test('running first, then finished in the last hour newest first, older ones out', () => {
  const rows = [
    row(task('old', { status: 'completed', startedAt: T0 - 3 * 3_600_000, endedAt: T0 - 2 * 3_600_000 })),
    row(task('d1', { status: 'completed', endedAt: T0 - 9 * MIN })),
    row(task('d2', { status: 'failed', endedAt: T0 - 4 * MIN })),
    row(task('r1', { startedAt: T0 - MIN })),
    row(task('r2', { startedAt: T0 - 20 * MIN })),
  ]
  assert.deepEqual(nowRows(rows, T0).map((r) => r.task.id), ['r2', 'r1', 'd2', 'd1'])
  assert.equal(nowNote(rows, T0), '2 working, 1 failed in the last 10 minutes')
  assert.equal(nowNote([], T0), '')
})

test('the trail lists starts and ends newest first, failures with their error', () => {
  const rows = [
    row(task('a', { title: 'Builder 1', status: 'failed', startedAt: T0 - 10 * MIN, endedAt: T0 - 5 * MIN, error: 'Edit refused' })),
    row(task('b', { title: 'Tail logs', startedAt: T0 - MIN })),
  ]
  const t = trail(rows)
  assert.deepEqual(t.map((e) => e.word), ['STARTED', 'FAILED', 'STARTED'])
  assert.equal(t[1].text, 'Builder 1 failed in Fix invoice numbers')
  assert.equal(t[1].detail, 'Edit refused, 5m 00s')
  assert.equal(t[0].text, 'Tail logs started in Fix invoice numbers')
  assert.equal(trail(rows, 2).length, 2)
})

test('cron periods and relative words', () => {
  assert.equal(cronPeriod('*/10 * * * *'), 10 * MIN)
  assert.equal(cronPeriod('5 * * * *'), 3_600_000)
  assert.equal(cronPeriod('0 9 * * 1'), null)
  assert.equal(relWord(T0 + 33 * MIN, T0), 'today, in 33m')
  assert.equal(relWord(T0 + 3 * 86_400_000, T0), 'in 3 days')
})

test('schedule rows merge every source and sort by time', () => {
  const rows = scheduleRows({
    wakeups: [{ id: 1, title: 'Ship', wakeAt: new Date(T0 + 33 * MIN).toISOString(), prompt: 'Promote to prod', everyMinutes: null, firedAt: null }],
    continues: [{ key: 'k', tabId: 't', title: 'Android', at: T0 + 90 * MIN }],
    threads: [{ tabId: 'a', title: 'Fix', crons: [{ id: 'c1', schedule: '*/10 * * * *', recurring: true, prompt: '/loop 10m check' }], nextWake: null }],
    watchers: [
      { id: 'w1', name: 'Nightly sweep', goal: 'Look at errors', enabled: true, nextRun: T0 + 6 * 3_600_000, every: 'adaptive' },
      { id: 'w2', name: 'Paused one', goal: '', enabled: false, nextRun: null, every: '1h' },
    ],
  }, T0)
  assert.deepEqual(rows.map((r) => r.kind), ['LOOP', 'WAKE-UP', 'AUTO-CONTINUE', 'WATCHER'])
  assert.equal(rows[0].every, 'every 10m')
  assert.equal(rows[3].repeats, 'adaptive')
})

test('the strip starts at the current hour, drops what is past 24h, and stacks overlapping labels', () => {
  const ev = (key: string, mins: number, label = 'Promote 4.18 now') => ({ key, kind: 'WAKE-UP' as const, at: T0 + mins * MIN, label })
  const s = layoutStrip([ev('a', 33), ev('b', 40), ev('c', 45), ev('d', 600), ev('e', 25 * 60)], T0)
  assert.equal(s.hours.length, 24)
  assert.equal(new Date(s.start).getMinutes(), 0)
  assert.ok(Math.abs(s.nowX - 27 / 1440) < 1e-9)
  assert.deepEqual(s.ticks.map((t) => t.key), ['a', 'b', 'c', 'd'])
  assert.deepEqual(s.ticks.map((t) => t.row), [0, 1, 2, 0])
  assert.ok(s.ticks.every((t) => !t.clipped))
  const crowded = layoutStrip([ev('a', 33), ev('b', 34), ev('c', 35), ev('d', 36)], T0)
  assert.equal(crowded.ticks[3].clipped, true)
})

test('a loop gets a band to the end of the strip', () => {
  const rows = scheduleRows({ wakeups: [], continues: [], threads: [{ tabId: 'a', title: 'Fix', crons: [{ id: 'c', schedule: '*/10 * * * *', recurring: true, prompt: 'x' }], nextWake: null }], watchers: [] }, T0)
  const s = layoutStrip(ticksOf(rows, T0), T0)
  assert.equal(s.ticks[0].band, 1)
})
