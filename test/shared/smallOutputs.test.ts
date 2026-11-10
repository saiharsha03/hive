// Small wrong answers found in review, one case each: cron labels and days, a goal's condition, a teammate's name,
// a dated usage-limit reset, a path read as pathspec magic, and files that only look like dotenv copies.
import { describe, expect, it } from 'vitest'
import { describeCron, nextRun } from '../../src/shared/cronCore'
import { goalReduce, parseGoalReply, type Goal } from '../../src/shared/goalCore'
import { nameTaken, targetsOf, type Team } from '../../src/shared/teamCore'
import { resetFromText } from '../../src/shared/continueCore'
import { safePath } from '../../src/shared/gitCore'
import { envCopies, hasWork, isDotenvName } from '../../src/shared/worktreeCore'

const at = (s: string) => new Date(s) // local time

describe('cron', () => {
  it('labels only an even step as "every n"', () => {
    expect(describeCron('*/10 * * * *')).toBe('every 10m')
    expect(describeCron('*/90 * * * *')).toBe('hourly at :00') // 90 never fits in an hour: it fires at :00 only
    expect(describeCron('*/7 * * * *')).toBe('*/7 * * * *') // restarts at each hour, so not every 7 minutes
    expect(describeCron('0 */2 * * *')).toBe('every 2h')
    expect(describeCron('5 */2 * * *')).toBe('every 2h at :05') // the :05 used to be dropped
    expect(describeCron('0 */5 * * *')).toBe('0 */5 * * *')
    expect(describeCron('0 */30 * * *')).toBe('daily at 0:00')
  })

  it('a step in a day field does not make it "either day": both must match', () => {
    // every Monday that falls on an odd day of the month: from Fri Oct 30 2026, Mon Nov 2 is even, Mon Nov 9 is odd
    expect(nextRun('0 0 */2 * 1', at('2026-10-30T12:00:00'))).toEqual(at('2026-11-09T00:00:00'))
    // every other day, any weekday
    expect(nextRun('0 0 */2 * *', at('2026-11-01T12:00:00'))).toEqual(at('2026-11-03T00:00:00'))
    // two restricted fields are still "either"
    expect(nextRun('0 8 1 * 1', at('2026-10-30T12:00:00'))).toEqual(at('2026-11-01T08:00:00'))
  })
})

describe('a goal whose condition ends in a parenthesis', () => {
  it('is the same goal when "Goal active" repeats it: the start time is kept', () => {
    const set = parseGoalReply('Goal set: tests pass (all of them)')!
    const goal = goalReduce(null, { t: 'reply', reply: set, now: 100 }) as Goal
    expect(goal.condition).toBe('tests pass (all of them)')
    const again = goalReduce(goal, { t: 'reply', reply: parseGoalReply('Goal active: tests pass (all of them)')!, now: 900 })
    expect(again).toEqual({ condition: 'tests pass (all of them)', status: 'active', setAt: 100 })
  })
  it('a status note is still read as a note', () => {
    const goal: Goal = { condition: 'the file x exists', status: 'active', setAt: 100 }
    const r = parseGoalReply('Goal active: the file x exists (not yet evaluated)')!
    expect(r).toMatchObject({ kind: 'active', condition: 'the file x exists', note: 'not yet evaluated' })
    expect(goalReduce(goal, { t: 'reply', reply: r, now: 900 })).toEqual(goal)
    // another goal starts its own clock
    expect(goalReduce(goal, { t: 'reply', reply: parseGoalReply('Goal active: something else (not yet evaluated)')!, now: 900 })).toEqual({ condition: 'something else', status: 'active', setAt: 900 })
  })
})

describe('team names', () => {
  const team: Team = { id: 't', name: 'T', goal: 'g', dir: '/d', createdAt: 1, lead: { id: 'lead-1', title: 'Lead' }, members: [{ id: 'm1', name: 'Builder', role: 'builder', cwd: '/c', joinedAt: 2 }] }
  it('"everyone" means all, so nobody can be called that', () => {
    expect(targetsOf(team, 'Everyone').map((p) => p.name)).toEqual(['Lead', 'Builder'])
    expect(nameTaken(team, 'Everyone')).toBe(true)
    expect(nameTaken(team, 'everyone ')).toBe(true)
    expect(nameTaken(team, 'Reviewer')).toBe(false)
  })
})

describe('a usage-limit reset with a date', () => {
  const now = new Date(2026, 10, 4, 13, 0).getTime() // Nov 4 2026, 1 pm local
  it('is that day, not the next time the clock shows that hour', () => {
    expect(resetFromText('Weekly limit reached ∙ resets Nov 12, 3pm', now)).toBe(new Date(2026, 10, 12, 15, 0).getTime())
    expect(resetFromText('resets Nov 12 at 3:30 pm', now)).toBe(new Date(2026, 10, 12, 15, 30).getTime())
    expect(resetFromText('resets on November 12th, 9am', now)).toBe(new Date(2026, 10, 12, 9, 0).getTime())
    expect(resetFromText('resets Nov 4, 3pm', now)).toBe(new Date(2026, 10, 4, 15, 0).getTime()) // later today
  })
  it('rolls into next year once it has passed', () => {
    expect(resetFromText('resets Jan 2, 9am', now)).toBe(new Date(2027, 0, 2, 9, 0).getTime())
    expect(resetFromText('resets Nov 4, 9am', now)).toBe(new Date(2027, 10, 4, 9, 0).getTime())
  })
  it('honours a named zone', () => {
    expect(resetFromText('resets Nov 12, 3pm (America/Chicago)', Date.UTC(2026, 10, 4, 12, 0))).toBe(Date.UTC(2026, 10, 12, 21, 0))
    expect(resetFromText('resets Jul 1, 9am (UTC)', Date.UTC(2026, 10, 4, 12, 0))).toBe(Date.UTC(2027, 6, 1, 9, 0))
  })
  it('gives nothing for a day it cannot read, and the plain form still works', () => {
    expect(resetFromText('resets Monday 3pm', now)).toBeNull()
    expect(resetFromText('resets Foo 12, 3pm', now)).toBeNull()
    expect(resetFromText('resets Feb 31, 3pm', now)).toBeNull()
    expect(resetFromText('resets 3pm', now)).toBe(new Date(2026, 10, 4, 15, 0).getTime())
  })
})

describe('git paths from the page', () => {
  it('are never pathspec magic', () => {
    for (const bad of [':/', ':(top)*.ts', ':!keep.txt', ':^x', ':(exclude)a']) expect(safePath(bad), bad).toBe(false)
    for (const ok of ['src/a.ts', 'pages/[id].tsx', 'docs/what: why.md', 'dir/:odd']) expect(safePath(ok), ok).toBe(true)
  })
})

describe('dotenv copies in a thread worktree', () => {
  it('are only real dotenv names', () => {
    for (const yes of ['.env', '.env.local', '.env.development.local', '.env.test', '.env.production_eu']) expect(isDotenvName(yes), yes).toBe(true)
    for (const no of ['.envrc', '.environment-notes.md', '.envoy.yaml', '.env-notes', '.env.', 'x.env', 'env', '.env/x', '.env local']) expect(isDotenvName(no), no).toBe(false)
  })
  it('a file that only starts with .env is work: it is saved, never deleted with the worktree', () => {
    expect(hasWork('?? .env\n?? .env.development.local\n?? node_modules/\n')).toBe(false)
    for (const line of ['?? .envrc', '?? .environment-notes.md', '?? .envoy.yaml', '?? ".env notes.md"']) expect(hasWork(`${line}\n`), line).toBe(true)
    expect(envCopies('?? .env\n?? .env.local\n?? .envrc\n?? .environment-notes.md\n')).toEqual(['.env', '.env.local'])
  })
})
