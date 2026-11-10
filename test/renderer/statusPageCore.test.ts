// the Status page's forecast, context segments, MCP words and formats
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { addReading, compactTick, contextSegments, contextShort, forecast, forecastText, hooksText, mcpNote, mcpState, needsRead, resetText, shortSize, versionNote, windowOf } from '../../src/renderer/src/pages/statusCore'

const T0 = new Date(2026, 10, 9, 13, 0, 0).getTime()
const MIN = 60_000

test('one reading: on track unless above 90', () => {
  assert.deepEqual(forecast([{ at: T0, pct: 40 }], T0 + 3_600_000, T0), { kind: 'ontrack' })
  assert.deepEqual(forecast([{ at: T0, pct: 91 }], T0 + 3_600_000, T0), { kind: 'near' })
  assert.deepEqual(forecast([], null, T0), { kind: 'ontrack' })
})

test('a rising rate that reaches 100% before the reset says when', () => {
  const r = [{ at: T0, pct: 50 }, { at: T0 + 10 * MIN, pct: 60 }] // 1% a minute
  const f = forecast(r, T0 + 2 * 3_600_000, T0 + 10 * MIN)
  assert.deepEqual(f, { kind: 'hit', at: T0 + 50 * MIN })
  assert.equal(forecastText(f), 'At this rate you reach 100% at 13:50')
})

test('a rate that reaches 100% only after the reset is on track', () => {
  const r = [{ at: T0, pct: 10 }, { at: T0 + 10 * MIN, pct: 11 }]
  assert.deepEqual(forecast(r, T0 + 30 * MIN, T0 + 10 * MIN), { kind: 'ontrack' })
  assert.equal(forecastText({ kind: 'ontrack' }), 'On track')
})

test('flat or too-close readings do not forecast', () => {
  assert.deepEqual(forecast([{ at: T0, pct: 30 }, { at: T0 + 5 * MIN, pct: 30 }], null, T0 + 5 * MIN), { kind: 'ontrack' })
  assert.deepEqual(forecast([{ at: T0, pct: 30 }, { at: T0 + 20_000, pct: 40 }], null, T0 + 20_000), { kind: 'ontrack' })
})

test('a drop in the percentage starts the readings again', () => {
  let r = addReading([], T0, 80)
  r = addReading(r, T0 + MIN, 85)
  assert.equal(r.length, 2)
  r = addReading(r, T0 + 2 * MIN, 3)
  assert.deepEqual(r, [{ at: T0 + 2 * MIN, pct: 3 }])
  assert.equal(addReading(r, T0 + 2 * MIN, 4).length, 1)
})

test('reset text and window names', () => {
  assert.equal(resetText(new Date(T0 + 108 * MIN).toISOString(), T0), 'resets 14:48, in 1h 48m')
  assert.equal(resetText(null, T0), '')
  assert.equal(windowOf('Current session (5-hour)', 'five_hour'), 'five')
  assert.equal(windowOf('Weekly', 'seven_day'), 'seven')
  assert.equal(windowOf('Opus', 'x'), 'other')
})

test('context segments add to 100 and the tick sits at the compact point', () => {
  const s = contextSegments({ total: 112_480, max: 1_000_000 }, { system: 10_000, tools: 14_000, memory: 8_000, messages: 80_480 })
  assert.equal(Math.round(s.reduce((a, x) => a + x.pct, 0)), 100)
  assert.equal(s[0].pct, 2.4)
  assert.deepEqual(contextSegments({ total: 250_000, max: 1_000_000 }).map((x) => x.pct), [25, 75])
  assert.equal(compactTick(950_000, 1_000_000), 95)
  assert.equal(compactTick(null, 1_000_000), null)
  assert.equal(contextShort(112_480, 1_000_000), '112k / 1M')
  assert.equal(shortSize(200_000), '200k')
})

test('MCP words and the connected count', () => {
  assert.equal(mcpState('connected').tone, 'done')
  assert.deepEqual(mcpState('needs-auth'), { word: 'NEEDS SIGN-IN', tone: 'wait', action: 'signin' })
  assert.equal(mcpState('failed').action, 'retry')
  assert.equal(mcpState('pending').tone, 'idle')
  assert.equal(mcpNote([{ status: 'connected' }, { status: 'failed' }, { status: 'connected' }]), '2 of 3 connected')
})

test('version, hooks and read freshness', () => {
  assert.deepEqual(versionNote('2.1.5', '2.1.5'), { text: '2.1.5', update: null })
  assert.deepEqual(versionNote('2.1.5', '2.2.0'), { text: '2.1.5', update: '2.2.0' })
  assert.deepEqual(versionNote('2.10.0', '2.9.0'), { text: '2.10.0', update: null })
  assert.equal(hooksText({ active: 9, failing: 0 }), '9 active, 0 failing')
  assert.equal(needsRead(undefined, T0), true)
  assert.equal(needsRead(T0 - 5000, T0), false)
  assert.equal(needsRead(T0 - 10_000, T0), true)
})
