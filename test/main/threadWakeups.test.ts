// Thread wake-ups: stored on disk, fired once when due (late ones say so), repeats skip missed slots, failures handled.
import { afterAll, beforeEach, expect, test } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import * as w from '../../src/main/threadWakeups'
import { tempDir } from '../support/tools'

const tmp = tempDir('wakeups')
afterAll(() => tmp.cleanup())
let n = 0
let sent: { sessionId: string; text: string }[] = []
beforeEach(() => {
  w.setWakeupsFile(path.join(tmp.dir, `w${n++}.db`))
  sent = []
  w.initThreadWakeups(async (sessionId, text) => { sent.push({ sessionId, text }) }, { auto: false })
})
const T0 = new Date('2026-11-05T09:00:00').getTime()
const min = 60_000

test('a one-off wake-up fires once when due, with its prompt, and is kept on disk', async () => {
  w.addWakeup({ sessionId: 's1', title: 'T', at: new Date(T0), prompt: 'check the deploy' })
  expect(fs.existsSync(w.wakeupsFile())).toBe(true)
  expect(await w.tick(T0 - min)).toBe(0)
  expect(await w.tick(T0 + 10_000)).toBe(1)
  expect(sent[0].sessionId).toBe('s1')
  expect(sent[0].text).toMatch(/^\[Scheduled wake-up #1, due /)
  expect(sent[0].text).toMatch(/check the deploy$/)
  expect(sent[0].text).not.toMatch(/late/)
  expect(await w.tick(T0 + 20_000)).toBe(0)
  expect(w.listWakeups()).toEqual([])
})

test('one missed while Hive was closed fires once on return and says how late', async () => {
  w.addWakeup({ sessionId: 's1', title: 'T', at: new Date(T0), prompt: 'p' })
  expect(await w.tick(T0 + 90 * min)).toBe(1)
  expect(sent[0].text).toMatch(/90 min late: Hive was closed or the laptop was asleep/)
})

test('a repeating one catches up once and moves to its next slot after now', async () => {
  w.addWakeup({ sessionId: 's1', title: 'T', at: new Date(T0), prompt: 'p', everyMinutes: 30 })
  expect(await w.tick(T0 + 100 * min)).toBe(1) // slots 0, 30, 60, 90 missed: one wake, not four
  const [r] = w.listWakeups('s1')
  expect(Date.parse(r.wake_at)).toBe(T0 + 120 * min)
  expect(await w.tick(T0 + 110 * min)).toBe(0)
  expect(await w.tick(T0 + 120 * min)).toBe(1)
  expect(w.nextSlot(T0, 30, T0)).toBe(T0 + 30 * min)
})

test('only the owning session (or the user) cancels', () => {
  const r = w.addWakeup({ sessionId: 's1', title: 'T', at: new Date(T0), prompt: 'p' })
  expect(w.cancelWakeup(r.id, 's2')).toBe(false)
  expect(w.cancelWakeup(r.id, 's1')).toBe(true)
  expect(w.listWakeups()).toEqual([])
  const r2 = w.addWakeup({ sessionId: 's1', title: 'T', at: new Date(T0), prompt: 'p' })
  expect(w.cancelWakeup(r2.id)).toBe(true)
})

test('a window not ready keeps it pending; a session that is gone fails it', async () => {
  w.addWakeup({ sessionId: 's1', title: 'T', at: new Date(T0), prompt: 'p' })
  w.initThreadWakeups(async () => { throw new Error('window not ready') }, { auto: false })
  expect(await w.tick(T0 + min)).toBe(0)
  expect(w.listWakeups()).toHaveLength(1)
  w.initThreadWakeups(async () => { throw new Error('No thread or session "s1".') }, { auto: false })
  await w.tick(T0 + 2 * min)
  expect(w.listWakeups()).toEqual([])
})

test('bad input is refused', () => {
  expect(() => w.addWakeup({ sessionId: '', title: 'T', at: new Date(T0), prompt: 'p' })).toThrow(/no session/)
  expect(() => w.addWakeup({ sessionId: 's', title: 'T', at: new Date(NaN), prompt: 'p' })).toThrow(/invalid/)
  expect(() => w.addWakeup({ sessionId: 's', title: 'T', at: new Date(T0), prompt: ' ' })).toThrow(/empty/)
  expect(() => w.addWakeup({ sessionId: 's', title: 'T', at: new Date(T0), prompt: 'p', everyMinutes: 1 })).toThrow(/at least 5/)
  expect(w.formatWakeups([])).toBe('No pending wake-ups.')
})

test('the window hears every change: added, cancelled, fired', async () => {
  let changes = 0
  w.onWakeupsChanged(() => { changes++ })
  const a = w.addWakeup({ sessionId: 's9', title: 'T', at: new Date(T0), prompt: 'one' })
  const b = w.addWakeup({ sessionId: 's9', title: 'T', at: new Date(T0 + 60 * min), prompt: 'two' })
  expect(changes).toBe(2)
  expect(w.cancelWakeup(b.id)).toBe(true) // the user, from the desktop: any session's
  expect(w.cancelWakeup(b.id)).toBe(false) // already cancelled: no change
  expect(changes).toBe(3)
  expect(await w.tick(T0 + 1000)).toBe(1)
  expect(changes).toBe(4)
  expect(w.listWakeups().map((r) => r.id)).not.toContain(a.id)
  w.onWakeupsChanged(() => {})
})

test('switched off for the whole app, a due wake-up waits and nothing is dropped; back on, it fires once', async () => {
  w.addWakeup({ sessionId: 's9', title: 'T', at: new Date(T0), prompt: 'check the deploy' })
  w.setWakeupsOff(true)
  try {
    expect(w.wakeupsPaused()).toBe(true)
    expect(await w.tick(T0 + 10_000)).toBe(0)
    expect(sent).toEqual([])
    expect(w.listWakeups().length).toBe(1)
  } finally { w.setWakeupsOff(false) }
  expect(await w.tick(T0 + 20_000)).toBe(1)
  expect(sent[0].sessionId).toBe('s9')
})
