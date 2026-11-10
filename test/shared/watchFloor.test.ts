// The shortest sweep interval: a schedule under it is refused when saved, and one already on disk runs at the floor.
import { describe, expect, it } from 'vitest'
import { MIN_EVERY_MS, atLeastMin, parseEvery, parseTiers, tooShort } from '../../src/shared/watchCore'
import { checkDraft, draftOf, normalizeSchedule, normalizeWatcher, watcherConfig } from '../../src/shared/watchersCore'

const M = 60_000

describe('the interval floor', () => {
  it('is five minutes', () => {
    expect(MIN_EVERY_MS).toBe(5 * M)
    expect(tooShort(parseEvery('1s'))).toBe(true)
    expect(tooShort(parseEvery('0.001s'))).toBe(true)
    expect(tooShort(parseEvery('4m'))).toBe(true)
    expect(tooShort(parseEvery('5m'))).toBe(false)
    expect(tooShort(parseEvery('300s'))).toBe(false)
    expect(tooShort(parseEvery('1h'))).toBe(false)
    expect(tooShort(parseEvery('off'))).toBe(false) // no sweeps is not a short interval
    expect(tooShort(parseEvery('soon'))).toBe(false) // not an interval at all: a different problem
    expect(atLeastMin(1000)).toBe(5 * M)
    expect(atLeastMin(3_600_000)).toBe(3_600_000)
    expect(atLeastMin(null)).toBeNull()
  })

  it('a schedule under it is a problem (create and update refuse it)', () => {
    expect(normalizeSchedule('1s').problems).toEqual(['every: 1s is shorter than 5m, the shortest interval'])
    expect(normalizeSchedule({ every: '90s' }).problems).toHaveLength(1)
    expect(normalizeSchedule('5m').problems).toEqual([])
    expect(normalizeSchedule('off').problems).toEqual([])
    expect(normalizeSchedule({ every: 'adaptive', tiers: '50:1m,100:1d' }).problems).toEqual(['tiers: 50:1m: the shortest interval is 5m'])
    expect(parseTiers('50:1m,100:1d').tiers).toBeNull()
    expect(parseTiers('50:5m,100:off').tiers).toEqual([{ below: 50, everyMs: 5 * M }, { below: 100, everyMs: null }])
  })

  it('the schedule editor says so at the field', () => {
    const fixed = checkDraft({ ...draftOf({ every: '1h' }), every: '1m' })
    expect(fixed.schedule).toBeNull()
    expect(fixed.errors).toEqual([{ field: 'every', message: 'The shortest interval is 5m' }])
    const tiers = checkDraft({ ...draftOf({ every: 'adaptive' }), tiers: [{ below: '50', every: '30s' }, { below: '100', every: '1d' }] })
    expect(tiers.errors).toEqual([{ field: 'tier-0-every', message: 'Tier 1: the shortest interval is 5m' }])
    expect(checkDraft({ ...draftOf({ every: '1h' }), every: '5m' }).schedule).toEqual({ every: '5m', daily: null, weekly: null })
  })

  it('a watcher.json saved before the floor keeps its schedule as written and runs at the floor', () => {
    const fixed = normalizeWatcher({ name: 'Old', schedule: { every: '1m' } })!
    expect(fixed.schedule.every).toBe('1m') // not silently turned into another kind of schedule
    expect(watcherConfig('C:/w/old', fixed).everyMs).toBe(5 * M)
    const adaptive = normalizeWatcher({ name: 'Old', schedule: { every: 'adaptive', tiers: '50:30s,100:1h' } })!
    expect(adaptive.schedule.tiers).toBe('50:30s,100:1h')
    expect(watcherConfig('C:/w/old', adaptive).tiers).toEqual([{ below: 50, everyMs: 5 * M }, { below: 100, everyMs: 3_600_000 }])
    // a table that is broken in another way still falls back to the default one
    const broken = normalizeWatcher({ name: 'Old', schedule: { every: 'adaptive', tiers: '50:soon' } })!
    expect(watcherConfig('C:/w/old', broken).tiers).toHaveLength(4)
  })
})
