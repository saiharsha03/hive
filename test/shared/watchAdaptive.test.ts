import { test } from 'vitest'
import assert from 'node:assert/strict'
import { DEFAULT_TIERS, dueKind, nextRuns, parseTiers, pickTier, type WatchConfig, type WatchState } from '../../src/shared/watchCore'

const H = 3_600_000
const D = 24 * H
const tiers = parseTiers(DEFAULT_TIERS).tiers!

test('default tiers parse', () => {
  assert.deepEqual(tiers, [{ below: 50, everyMs: H }, { below: 60, everyMs: 3 * H }, { below: 70, everyMs: 6 * H }, { below: 100, everyMs: D }])
  assert.deepEqual(parseTiers(' 50% : 30m , 100:off ').tiers, [{ below: 50, everyMs: 30 * 60_000 }, { below: 100, everyMs: null }])
})

test('boundaries pick the right tier', () => {
  assert.equal(pickTier(tiers, 0).everyMs, H)
  assert.equal(pickTier(tiers, 34).everyMs, H)
  assert.equal(pickTier(tiers, 49.9).everyMs, H)
  assert.equal(pickTier(tiers, 50).everyMs, 3 * H)
  assert.equal(pickTier(tiers, 59.99).everyMs, 3 * H)
  assert.equal(pickTier(tiers, 60).everyMs, 6 * H)
  assert.equal(pickTier(tiers, 70).everyMs, D)
  assert.equal(pickTier(tiers, 100).everyMs, D) // at or above the last threshold: the last tier
  assert.equal(pickTier(tiers, 130).everyMs, D)
  assert.deepEqual(pickTier(tiers, 34), { everyMs: H, pct: 34, tier: 0 })
})

test('unreadable usage takes the slowest tier', () => {
  assert.deepEqual(pickTier(tiers, null), { everyMs: D, pct: null, tier: 3 })
  assert.equal(pickTier(tiers, NaN).everyMs, D)
  // slowest is not always the last row; "off" counts as slowest
  assert.equal(pickTier(parseTiers('50:6h,100:1h').tiers!, null).everyMs, 6 * H)
  assert.equal(pickTier(parseTiers('50:1h,80:off,100:2h').tiers!, null).everyMs, null)
})

test('bad tier config is refused with a reason', () => {
  for (const [v, why] of [
    ['', 'no tiers'], ['50', 'not like'], ['50:soon', 'is not like 60m'], ['0:1h', 'between 1 and 100'], ['101:1h', 'between 1 and 100'],
    ['60:1h,50:2h', 'must rise'], ['50:1h,50:2h', 'must rise'], ['abc:1h', 'not like'],
  ] as const) {
    const r = parseTiers(v)
    assert.equal(r.tiers, null, v)
    assert.match(r.problem, new RegExp(why), v)
  }
})

test('the picked interval drives sweeps; reports keep their times', () => {
  const c: WatchConfig = { dir: 'C:/w', prompt: 'C:/w/watch.md', cwd: '', everyMs: H, tiers, daily: '08:00', weekly: null }
  const now = new Date(2026, 9, 31, 12, 0)
  const s: WatchState = { enabled: true, since: now.getTime() - 10 * D, last: { sweep: now.getTime() - 2 * H, daily: now.getTime() - 3 * H, weekly: null } }
  assert.equal(dueKind(now, { ...c, everyMs: pickTier(c.tiers!, 34).everyMs }, s, false), 'sweep') // 1h tier, 2h since
  assert.equal(dueKind(now, { ...c, everyMs: pickTier(c.tiers!, 65).everyMs }, s, false), null) // 6h tier
  const n = nextRuns(now, { ...c, everyMs: pickTier(c.tiers!, null).everyMs }, s)
  assert.equal(n.sweep, now.getTime() - 2 * H + D)
  assert.equal(n.daily, new Date(2026, 10, 1, 8, 0).getTime())
})
