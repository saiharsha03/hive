import { describe, expect, it } from 'vitest'
import { phoneThreads, type PhoneLive, type PhoneSaved, type PhoneWatcher } from '../../src/shared/threadsCore'

const now = 1_000_000
const saved = (id: string, updated: number, extra: Partial<PhoneSaved> = {}): PhoneSaved => ({ id, title: id, project: 'p', updated, ...extra })
const liveT = (tabId: string, sessionId: string | null, extra: Partial<PhoneLive> = {}): PhoneLive => ({ tabId, sessionId, title: tabId, folder: 'f', busy: false, ...extra })

describe('phoneThreads', () => {
  it('lists Watchers, Pinned, Waiting, Working, then Recent', () => {
    const w: PhoneWatcher[] = [{ name: 'Watch', tabId: null, sessionId: null, sessionIds: ['run1', 'run2'] }]
    const out = phoneThreads(
      [liveT('busy', 's-busy', { busy: true }), liveT('ask', 's-ask', { waitingReason: 'approve' })],
      [saved('run2', 9, { watcherRun: true }), saved('run1', 8, { watcherRun: true }), saved('a', 7), saved('pin', 6), saved('s-busy', 5)],
      w, { pin: { pinned: 1 } }, now)
    expect(out.map((t) => [t.id, t.section])).toEqual([['run2', 'watchers'], ['pin', 'pinned'], ['ask', 'waiting'], ['busy', 'working'], ['a', 'recent']])
    expect(out[0].title).toBe('Watch')
  })

  it("shows a watcher's current run with its live state and drops older runs and stray watcher runs", () => {
    const w: PhoneWatcher[] = [{ name: 'Watch', tabId: 'watcher-x-2', sessionId: null, sessionIds: ['run1'] }]
    const out = phoneThreads([liveT('watcher-x-2', null, { busy: true })], [saved('run1', 5, { watcherRun: true }), saved('other-run', 4, { watcherRun: true })], w, {}, now)
    expect(out).toEqual([{ id: 'watcher-x-2', title: 'Watch', folder: 'f', state: 'working', note: '', updated: 5, section: 'watchers' }])
  })

  it('lists an older watcher run resumed later as a live thread, but not while it sits idle', () => {
    const w: PhoneWatcher[] = [{ name: 'Watch', tabId: null, sessionId: null, sessionIds: ['run1', 'run2'] }]
    const busy = phoneThreads([liveT('watcher-x-9', 'run1', { busy: true })], [saved('run2', 5, { watcherRun: true })], w, {}, now)
    expect(busy.map((t) => [t.id, t.section])).toEqual([['run2', 'watchers'], ['watcher-x-9', 'working']])
    const idle = phoneThreads([liveT('watcher-x-9', 'run1')], [saved('run2', 5, { watcherRun: true })], w, {}, now)
    expect(idle.map((t) => t.id)).toEqual(['run2'])
  })

  it('leaves out closed, archived and still-snoozed threads; a due snooze is back in Recent', () => {
    const out = phoneThreads([], [saved('c', 4), saved('ar', 3), saved('sn', 2), saved('due', 1)], [],
      { c: { closedAt: 1 }, ar: { archivedAt: 1, pinned: 1 }, sn: { snoozedUntil: now + 1 }, due: { snoozedUntil: now - 1 } }, now)
    expect(out.map((t) => t.id)).toEqual(['due'])
  })

  it('keeps a working thread in Working even when pinned, and an idle open tab in Pinned by its session', () => {
    const out = phoneThreads([liveT('t1', 's1', { busy: true }), liveT('t2', 's2')], [saved('s1', 2), saved('s2', 1)], [], { s1: { pinned: 2 }, s2: { pinned: 1 } }, now)
    expect(out.map((t) => [t.id, t.section])).toEqual([['t2', 'pinned'], ['t1', 'working']])
  })

  it('orders pins newest first and caps Recent only', () => {
    const rows = [saved('p1', 9), saved('p2', 8), ...Array.from({ length: 5 }, (_, i) => saved(`r${i}`, 5 - i))]
    const out = phoneThreads([], rows, [], { p1: { pinned: 1 }, p2: { pinned: 2 } }, now, 3)
    expect(out.map((t) => t.id)).toEqual(['p2', 'p1', 'r0', 'r1', 'r2'])
  })
  it('puts a busy thread that asked for the user under Waiting, as the sidebar does', () => {
    const out = phoneThreads([liveT('t', 's', { busy: true, waitingReason: 'Needs your input' })], [], [], {}, now)
    expect(out.map((t) => [t.state, t.section])).toEqual([['waiting', 'waiting']])
  })

  it('puts Dependabot review threads, running or saved, in their own section; a pinned one stays pinned', () => {
    const out = phoneThreads([liveT('dependabot-o-r-5-1', 's5', { busy: true }), liveT('t', 's', { busy: true })],
      [saved('s5', 9, { dependabot: true }), saved('s6', 8, { dependabot: true }), saved('s7', 7, { dependabot: true }), saved('a', 6)], [], { s7: { pinned: 1 } }, now)
    expect(out.map((t) => [t.id, t.section])).toEqual([['s7', 'pinned'], ['t', 'working'], ['dependabot-o-r-5-1', 'dependabot'], ['s6', 'dependabot'], ['a', 'recent']])
  })

  it('caps Recent and Dependabot separately, so many reviews do not push out the user threads', () => {
    const rows = [...Array.from({ length: 3 }, (_, i) => saved(`b${i}`, 9 - i, { dependabot: true })), saved('a', 1)]
    expect(phoneThreads([], rows, [], {}, now, 2).map((t) => t.id)).toEqual(['b0', 'b1', 'a'])
  })
})
