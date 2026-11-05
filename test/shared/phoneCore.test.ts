import { test } from 'vitest'
import assert from 'node:assert/strict'
import { phoneTasks, phoneTeams, phoneWakeups } from '../../src/shared/phoneCore'
import type { Team } from '../../src/shared/teamCore'

const team = (over: Partial<Team> = {}): Team => ({
  id: 't1', name: 'PR 5', goal: 'finish it', dir: '/t', lead: { id: 'lead-1', title: 'Lead', sessionId: 'lead-s' }, createdAt: 1,
  members: [{ id: 'b-1', name: 'Builder', role: 'builder', cwd: '/c', joinedAt: 2, sessionId: 'b-s' }], ...over,
})

test('phoneTeams: running teams only, the state word, the id to open and the last posts', () => {
  const log = [1, 2, 3, 4, 5, 6].map((n) => ({ at: n, from: 'x', fromName: 'Lead', to: [], text: `post ${n}` }))
  const view = () => ({ states: { 'lead-1': { state: 'idle' as const }, 'b-1': { state: 'working' as const } }, log, liveId: (id: string) => (id === 'b-1' ? 'b-1' : null) })
  const [t] = phoneTeams([team(), team({ id: 't2', endedAt: 9 })], view)
  assert.equal(t.word, 'WORKING')
  assert.deepEqual(t.members.map((m) => [m.name, m.open, m.state]), [['Lead', 'lead-s', 'idle'], ['Builder', 'b-1', 'working']])
  assert.deepEqual(t.posts.map((p) => p.text), ['post 2', 'post 3', 'post 4', 'post 5', 'post 6'])
  assert.equal(phoneTeams([team({ pausedAt: 5 })], view)[0].word, 'PAUSED')
  assert.equal(phoneTeams([team()], () => ({ states: {}, log: [], liveId: () => null }))[0].word, 'IDLE')
})

test('phoneTasks: running work only, with its kind word and live line', () => {
  const base = { startedAt: 0, phases: [], agents: [] } as any
  const out = phoneTasks([{ ...base, id: 'a', kind: 'local_agent', title: 'Build rewind', status: 'running', now: 'Reading chat.ts' }, { ...base, id: 'b', kind: 'local_bash', title: 'npm test', status: 'completed' }])
  assert.deepEqual(out, [{ id: 'a', kind: 'Subagent', title: 'Build rewind', now: 'Reading chat.ts' }])
})

test('phoneWakeups: pending wake-ups and auto-continues, soonest first', () => {
  const rows = [
    { id: 7, session_id: 's1', title: 'Deploy', wake_at: '2026-11-05T15:00:00', prompt: 'check it', every_minutes: null, status: 'pending' },
    { id: 8, session_id: 's2', title: 'Old', wake_at: '2026-11-05T09:00:00', prompt: 'x', every_minutes: null, status: 'fired' },
  ]
  const out = phoneWakeups(rows, [{ key: 's3', title: 'Limited', at: Date.parse('2026-11-05T14:00:00') }])
  assert.deepEqual(out.map((w) => [w.kind, w.id, w.open]), [['continue', 's3', 's3'], ['wake', '7', 's1']])
})
