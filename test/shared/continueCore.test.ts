import { describe, expect, it } from 'vitest'
import { AFTER_RESET_MS, STAGGER_MS, catchUp, planWake, resetFromText, wakeNow, type Wake } from '../../src/shared/continueCore'

const now = new Date(2026, 10, 4, 13, 0).getTime()
describe('continueCore', () => {
  it('reads the reset from the limit message', () => {
    expect(resetFromText('Claude AI usage limit reached|1793800000', now)).toBe(1793800000 * 1000)
    expect(resetFromText("You've hit your limit · resets 3pm", now)).toBe(new Date(2026, 10, 4, 15, 0).getTime())
    expect(resetFromText('5-hour limit reached ∙ resets 12:30 am', now)).toBe(new Date(2026, 10, 5, 0, 30).getTime())
    expect(resetFromText('resets 1pm', now)).toBe(new Date(2026, 10, 5, 13, 0).getTime()) // already passed today
    expect(resetFromText('Something went wrong', now)).toBeNull()
    // a named zone wins over this computer's: 3pm Chicago (CST, UTC-6 in November) is 21:00 UTC
    expect(resetFromText('resets 3pm (America/Chicago)', Date.UTC(2026, 10, 4, 12, 0))).toBe(Date.UTC(2026, 10, 4, 21, 0))
    expect(resetFromText('resets 9am (UTC)', Date.UTC(2026, 10, 4, 12, 0))).toBe(Date.UTC(2026, 10, 5, 9, 0))
    // DST days in Chicago: 2026-11-01 falls back at 2am (3am is CST, UTC-6); 2027-03-14 springs forward (3pm is CDT, UTC-5)
    expect(resetFromText('resets 3am (America/Chicago)', Date.UTC(2026, 10, 1, 5, 0))).toBe(Date.UTC(2026, 10, 1, 9, 0))
    expect(resetFromText('resets 1:30am (America/Chicago)', Date.UTC(2026, 10, 1, 5, 0))).toBe(Date.UTC(2026, 10, 1, 7, 30)) // happens twice: the later
    expect(resetFromText('resets 3pm (America/Chicago)', Date.UTC(2027, 2, 14, 7, 0))).toBe(Date.UTC(2027, 2, 14, 20, 0))
    expect(resetFromText('resets 2:30am (America/Chicago)', Date.UTC(2027, 2, 14, 7, 0))).toBe(Date.UTC(2027, 2, 14, 8, 30)) // never happens: after the change
    expect(resetFromText('resets 3pm (Not/AZone)', now)).toBe(new Date(2026, 10, 4, 15, 0).getTime())
  })
  it('wakes a minute after the reset, spaced from other waiting threads', () => {
    const reset = now + 3_600_000
    expect(planWake(reset, [], now)).toBe(reset + AFTER_RESET_MS)
    expect(planWake(reset, [reset + AFTER_RESET_MS], now)).toBe(reset + AFTER_RESET_MS + STAGGER_MS)
    expect(planWake(reset, [reset + AFTER_RESET_MS, reset + AFTER_RESET_MS + STAGGER_MS], now)).toBe(reset + AFTER_RESET_MS + 2 * STAGGER_MS)
    expect(planWake(now - 10_000, [], now)).toBe(now + AFTER_RESET_MS) // a reset already past
  })
  it('spaces wakes that came due while Hive was closed', () => {
    const w = (key: string, at: number) => ({ key, tabId: key, cwd: '', title: key, at })
    const out = catchUp([w('b', now - 1000), w('a', now - 5000), w('c', now + 3_600_000)], now)
    expect(out.map((x) => [x.key, x.at])).toEqual([['a', now + AFTER_RESET_MS], ['b', now + AFTER_RESET_MS + STAGGER_MS], ['c', now + 3_600_000]])
  })
})

describe('wakeNow', () => {
  const w = (key: string, at: number, more = {}) => ({ key, tabId: key, cwd: '/c', title: key, at, since: 0, ...more })
  it('the limit came back: waiting threads go a minute from now, spaced, not at their planned reset', () => {
    expect(wakeNow([w('a', 9_000_000), w('b', 9_500_000)], 1_000, 500).map((x) => x.at)).toEqual([1_000 + AFTER_RESET_MS, 1_000 + AFTER_RESET_MS + STAGGER_MS])
  })
  it('never moves a wake later: successes every 30 s do not keep pushing it back', () => {
    let ws: Wake[] = [w('a', 9_000_000)]
    for (let t = 1_000; t < 300_000; t += 30_000) ws = wakeNow(ws, t, t - 100)
    expect(ws[0].at).toBe(1_000 + AFTER_RESET_MS)
  })
  it('repeated successes keep the spacing between waiting threads', () => {
    let ws: Wake[] = [w('a', 9_000_000), w('b', 9_500_000), w('c', 9_900_000)]
    for (let t = 1_000; t < 300_000; t += 30_000) ws = wakeNow(ws, t, t - 100)
    const at = ws.map((x) => x.at).sort((x, y) => x - y)
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(STAGGER_MS)
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(STAGGER_MS)
  })
  it('only wakes scheduled before the turn started, and only plan-wide limits', () => {
    const out = wakeNow([w('late', 9_000_000, { since: 2_000 }), w('opus', 9_000_000, { kind: 'seven_day_opus' })], 1_000, 1_500)
    expect(out.map((x) => x.at)).toEqual([9_000_000, 9_000_000])
  })
})
