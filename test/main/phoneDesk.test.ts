// Phone 2.0 on Orbit's side: quiet hours, pausing and running wake-ups, the usage guard's memory, wake-ups on rows by id
import { afterAll, beforeEach, test } from 'vitest'
import assert from 'node:assert/strict'
import path from 'node:path'
import { inQuiet, normalizeQuiet } from '../../src/main/quietHours'
import * as w from '../../src/main/threadWakeups'
import { guardMemory } from '../../src/main/mobile'
import { withWakes, type PhoneWakeup } from '../../src/shared/phoneCore'
import type { PhoneThread } from '../../src/shared/threadsCore'
import { tempDir } from '../support/tools'

const tmp = tempDir('phone-desk')
afterAll(() => tmp.cleanup())
let n = 0
let sent: { sessionId: string; text: string }[] = []
beforeEach(() => {
  w.setWakeupsFile(path.join(tmp.dir, `w${n++}.db`))
  sent = []
  w.initThreadWakeups(async (sessionId, text) => { sent.push({ sessionId, text }) }, { auto: false })
})
const T0 = new Date('2026-11-05T09:00:00').getTime()

test('quiet hours: off, a span within the day, one past midnight; bad times fall back', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m)
  assert.equal(inQuiet({ on: false, from: '22:00', to: '07:00' }, at(23)), false)
  const night = { on: true, from: '22:00', to: '07:00' }
  assert.deepEqual([at(23), at(3), at(7), at(12), at(21, 59)].map((d) => inQuiet(night, d)), [true, true, false, false, false])
  const lunch = { on: true, from: '12:00', to: '13:30' }
  assert.deepEqual([at(12, 15), at(13, 30), at(11)].map((d) => inQuiet(lunch, d)), [true, false, false])
  assert.deepEqual(normalizeQuiet({ on: true, from: '25:00', to: '7:05' }), { on: true, from: '22:00', to: '07:05' })
  assert.deepEqual(normalizeQuiet('nonsense'), { on: false, from: '22:00', to: '07:00' })
})

test('paused wake-ups fire nothing until resumed, then once; nothing is dropped', async () => {
  w.addWakeup({ sessionId: 's1', title: 'T', at: new Date(T0), prompt: 'check' })
  w.pauseWakeups(true)
  assert.equal(w.wakeupsPaused(), true)
  assert.equal(await w.tick(T0 + 60_000), 0)
  assert.equal(w.listWakeups().length, 1) // still pending
  w.pauseWakeups(false) // resuming checks at once: what came due fires now, once
  assert.equal(w.wakeupsPaused(), false)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(sent.length, 1)
  assert.equal(await w.tick(), 0)
})

test('run now fires one wake-up at once, even while paused; a repeating one keeps its schedule', async () => {
  const once = w.addWakeup({ sessionId: 's2', title: 'T', at: new Date(T0 + 3_600_000), prompt: 'later' })
  const rep = w.addWakeup({ sessionId: 's3', title: 'T', at: new Date(T0 + 3_600_000), prompt: 'often', everyMinutes: 30 })
  w.pauseWakeups(true)
  assert.equal(await w.runWakeupNow(once.id, T0), true)
  assert.deepEqual(sent.map((x) => x.sessionId), ['s2'])
  assert.ok(!w.listWakeups().some((r) => r.id === once.id)) // fired
  assert.equal(await w.runWakeupNow(rep.id, T0), true)
  assert.ok(w.listWakeups().some((r) => r.id === rep.id)) // a repeating one stays pending
  assert.equal(await w.runWakeupNow(99999, T0), false)
  w.pauseWakeups(false)
})

test("the usage guard's memory: what was said is kept across a restart (the newest 20)", () => {
  assert.deepEqual(guardMemory(JSON.stringify({ said: ['five_hour:x:85', 'five_hour:x:95'] })), ['five_hour:x:85', 'five_hour:x:95'])
  assert.equal(guardMemory(JSON.stringify({ said: Array.from({ length: 30 }, (_, i) => `k${i}`) })).length, 20)
  assert.deepEqual(guardMemory(null), [])
  assert.deepEqual(guardMemory('{ broken'), [])
})

test("a wake-up sits on its thread's row by session id, also when another thread has the same title", () => {
  const row = (id: string, sessionId: string | null): PhoneThread => ({ id, title: 'Same title', folder: 'f', state: 'idle', note: '', updated: 1, section: 'recent', sessionId })
  const wake: PhoneWakeup = { kind: 'wake', id: '1', open: 'sess-b', title: 'Same title', at: 5000, prompt: 'p', every: null }
  const rows = withWakes([row('tab-a', 'sess-a'), row('tab-b', 'sess-b')], [wake])
  assert.deepEqual(rows.map((r) => r.wakes), [undefined, 5000])
})
