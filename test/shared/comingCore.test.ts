import { test } from 'vitest'
import assert from 'node:assert/strict'
import { comingLabel, comingUp, nearest, whenWord, type ComingInput } from '../../src/shared/comingCore'

// local times, so the clock words read the same in any time zone
const NOW = new Date(2026, 0, 5, 12, 0, 0).getTime()
const at = (h: number, m: number) => new Date(2026, 0, 5, h, m, 0)
const base: ComingInput = { tabId: 't1', sessionId: 's1', crons: [], nextWake: null, wakeups: [], continues: [] }
const wake = (id: number, when: Date, over: Partial<ComingInput['wakeups'][number]> = {}) => ({ id, sessionId: 's1', wakeAt: when.toISOString(), prompt: `check ${id}`, everyMinutes: null, firedAt: null, ...over })
const loop = { id: 'c1', schedule: '30 14 * * *', recurring: true, prompt: 'Check the deploy' }

test('one loop: its next run is the time shown', () => {
  const rows = comingUp({ ...base, crons: [loop] }, NOW)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].at, at(14, 30).getTime())
  assert.equal(comingLabel(rows, NOW), '1 loop, next 14:30')
})

test('several wake-ups: the nearest is named, in minutes when it is close', () => {
  const rows = comingUp({ ...base, wakeups: [wake(1, at(15, 0)), wake(2, at(12, 12))] }, NOW)
  assert.deepEqual(rows.map((r) => r.key), ['wake:2', 'wake:1'])
  assert.equal(nearest(rows), at(12, 12).getTime())
  assert.equal(comingLabel(rows, NOW), '2 wake-ups, next in 12 min')
})

test('mixed kinds: counted by kind, the nearest time of them all', () => {
  const rows = comingUp({ ...base, crons: [loop], wakeups: [wake(1, at(16, 0))], continues: [{ key: 's1', tabId: 'other-tab', at: at(17, 0).getTime() }] }, NOW)
  assert.equal(comingLabel(rows, NOW), '1 loop, 1 wake-up and 1 automatic continue, next 14:30')
  assert.equal(comingLabel(comingUp({ ...base, crons: [loop], wakeups: [wake(1, at(13, 0))] }, NOW), NOW), '1 loop and 1 wake-up, next 13:00')
})

test('another thread\'s wake-ups and continues are not counted, nor one that already fired', () => {
  const rows = comingUp({
    ...base,
    wakeups: [wake(1, at(13, 0), { sessionId: 's2' }), wake(2, at(13, 0), { firedAt: at(11, 0).toISOString() }), wake(3, at(14, 0))],
    continues: [{ key: 's2', tabId: 't2', at: at(13, 0).getTime() }],
  }, NOW)
  assert.deepEqual(rows.map((r) => r.key), ['wake:3'])
  assert.deepEqual(comingUp({ ...base, sessionId: undefined, wakeups: [wake(1, at(13, 0))] }, NOW), []) // a thread with no session yet owns none
  assert.equal(comingLabel([], NOW), '')
})

test('the thread\'s own wake-up is one row, marked so a list that already says "Wakes in" can leave it out', () => {
  const rows = comingUp({ ...base, nextWake: at(12, 5).getTime() }, NOW)
  assert.deepEqual(rows.map((r) => [r.key, r.own]), [['wake:own', true]])
  assert.deepEqual(comingUp({ ...base, nextWake: NOW - 1 }, NOW), []) // already due: it is running, not coming up
})

test('the time word: minutes when close, the clock today, the day when it is not today', () => {
  assert.equal(whenWord(NOW + 30_000, NOW), 'in under a minute')
  assert.equal(whenWord(NOW + 5 * 60_000, NOW), 'in 5 min')
  assert.equal(whenWord(at(18, 45).getTime(), NOW), '18:45')
  assert.equal(whenWord(new Date(2026, 0, 6, 9, 0).getTime(), NOW), 'Tue 09:00')
})
