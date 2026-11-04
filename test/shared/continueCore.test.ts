import { describe, expect, it } from 'vitest'
import { AFTER_RESET_MS, STAGGER_MS, catchUp, planWake, resetFromText } from '../../src/shared/continueCore'

const now = new Date(2026, 10, 4, 13, 0).getTime()
describe('continueCore', () => {
  it('reads the reset from the limit message', () => {
    expect(resetFromText('Claude AI usage limit reached|1793800000', now)).toBe(1793800000 * 1000)
    expect(resetFromText("You've hit your limit · resets 3pm (America/Chicago)", now)).toBe(new Date(2026, 10, 4, 15, 0).getTime())
    expect(resetFromText('5-hour limit reached ∙ resets 12:30 am', now)).toBe(new Date(2026, 10, 5, 0, 30).getTime())
    expect(resetFromText('resets 1pm', now)).toBe(new Date(2026, 10, 5, 13, 0).getTime()) // already passed today
    expect(resetFromText('Something went wrong', now)).toBeNull()
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
