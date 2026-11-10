import { test } from 'vitest'
import assert from 'node:assert/strict'
import { limitedAnswer, noteActions, noteKind, oneTapAsk, phoneInbox, phoneTasks, phoneTeams, phoneWakeups, riskyChoice, type PhoneAsk } from '../../src/shared/phoneCore'
import type { PhoneThread } from '../../src/shared/threadsCore'
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

const ask = (id: string, options: string[], over: Partial<PhoneAsk['questions'][0]> = {}): PhoneAsk =>
  ({ id, questions: [{ question: 'Promote ledger-web 4.18 to prod?', header: 'Deploy', multiSelect: false, options: options.map((label) => ({ label, description: '' })), ...over }] })
const thread = (id: string, state: PhoneThread['state'], over: Partial<PhoneThread> = {}): PhoneThread =>
  ({ id, title: `Thread ${id}`, folder: 'ledger', state, note: '', updated: 100, section: 'recent', ...over })

test('oneTapAsk: only one open question with one choice to make', () => {
  assert.deepEqual(oneTapAsk([ask('a1', ['Promote now', 'Wait to 14:00'])]), { id: 'a1', question: 'Promote ledger-web 4.18 to prod?', options: ['Promote now', 'Wait to 14:00'] })
  assert.equal(oneTapAsk([]), null)
  assert.equal(oneTapAsk([ask('a1', ['A']), ask('a2', ['B'])]), null) // two asks open
  assert.equal(oneTapAsk([ask('a1', ['A', 'B'], { multiSelect: true })]), null) // pick-many needs the card
  const two = ask('a1', ['A'])
  assert.equal(oneTapAsk([{ ...two, questions: [...two.questions, ...two.questions] }]), null) // two questions in one ask
})

test('phoneInbox: waiting threads with their one-tap question, then failures not looked at; and what is coming up', () => {
  const threads = [thread('w1', 'waiting', { note: 'Promote now or after the freeze?' }), thread('b1', 'working'), thread('i1', 'idle'), thread('w2', 'waiting')]
  const fails = [{ thread: 'i1', title: 'Bump node to 22', note: 'docker build failed at step 7 of 12', at: 50 }, { thread: 'b1', title: 'Retried', note: 'x', at: 60 }, { thread: 'gone', title: 'Older', note: 'y', at: 10 }]
  const wake = phoneWakeups([
    { id: 1, session_id: 's1', title: 'Promote', wake_at: new Date(5_000_000).toISOString(), prompt: 'go', every_minutes: null, status: 'pending' },
    { id: 2, session_id: 's2', title: 'Past', wake_at: new Date(1_000).toISOString(), prompt: 'late', every_minutes: null, status: 'pending' },
  ], [{ key: 's3', title: 'Drafts', at: 6_000_000 }])
  const box = phoneInbox(threads, { w1: [ask('a1', ['Promote now', 'Wait to 14:00'])], w2: [] }, fails, wake, 4_000_000)
  assert.deepEqual(box.needs.map((n) => [n.kind, n.thread, n.note]), [
    ['waiting', 'w1', 'Promote now or after the freeze?'],
    ['waiting', 'w2', 'Needs your input'],
    ['failed', 'i1', 'docker build failed at step 7 of 12'], // newest failure first; b1 is working again, so it is not listed
    ['failed', 'gone', 'y'],
  ])
  assert.deepEqual(box.needs[0].ask, { id: 'a1', question: 'Promote ledger-web 4.18 to prod?', options: ['Promote now', 'Wait to 14:00'] })
  assert.equal(box.needs[1].ask, undefined)
  assert.deepEqual(box.coming.map((w) => w.title), ['Promote', 'Drafts']) // one long past is left out
  assert.equal(phoneInbox(threads, {}, [], wake, 0, 1).coming.length, 1)
})

test('riskyChoice: only a choice that holds back and names no action may be picked without the fingerprint', () => {
  for (const l of ['Wait to 14:00', 'Not yet', 'No', 'Show me the 14 commits first', 'Skip this one', "Don't change it", 'Cancel', 'Leave it as it is', 'Explain the failure', 'Later today']) assert.equal(riskyChoice(l), false, l)
  for (const l of ['Promote now', 'Yes', 'Go ahead', 'Delete the branch', 'Merge it', 'Continue', 'Option B', 'Wait for the freeze, promote at 14:00', 'Show the diff, then push', 'No, force push instead', 'Stop and delete the worktree', '']) assert.equal(riskyChoice(l), true, l)
})

test('noteActions: a one-tap question gives its choices (risky ones open the app), a working thread gives Stop', () => {
  assert.deepEqual(noteActions({ working: false, asks: [ask('a1', ['Promote now', 'Wait to 14:00'])] }), { ask: { id: 'a1', opts: [{ l: 'Promote now', open: true }, { l: 'Wait to 14:00' }] } })
  assert.deepEqual(noteActions({ working: true, asks: [] }), { stop: true })
  assert.deepEqual(noteActions({ working: false, asks: [] }), {})
  assert.deepEqual(noteActions(null), {})
  assert.deepEqual(noteActions({ working: true, asks: [ask('a1', ['A', 'B', 'C', 'D'])] }), {}) // more than fit: answer in the app
  assert.deepEqual(noteActions({ working: false, asks: [ask('a1', ['x'.repeat(41)])] }), {}) // too long for a button
})

test('limitedAnswer: an answer under the notification key is taken only for the open question, its own label, and a safe one', () => {
  const peek = { working: false, asks: [ask('a1', ['Promote now', 'Wait to 14:00'])] }
  assert.deepEqual(limitedAnswer(peek, 'a1', 'Wait to 14:00'), { answers: { 'Promote ledger-web 4.18 to prod?': 'Wait to 14:00' } })
  assert.deepEqual(limitedAnswer(peek, 'a1', 'Promote now'), { refused: 'That choice needs the app to be opened' })
  assert.deepEqual(limitedAnswer(peek, 'a1', 'Wait forever'), { refused: 'That is not one of the choices' }) // free text never
  assert.deepEqual(limitedAnswer(peek, 'a0', 'Wait to 14:00'), { refused: 'That question is no longer open' })
  assert.deepEqual(limitedAnswer(null, 'a1', 'Wait to 14:00'), { refused: 'That question is no longer open' })
  assert.deepEqual(limitedAnswer({ working: false, asks: [] }, 'a1', 'No'), { refused: 'That question is no longer open' })
})

test('noteKind: from the titles Hive writes', () => {
  assert.deepEqual(['Question: Ship', 'Waiting: Ship', 'Failed: Bump node', 'Finished: Sweep', 'Usage limit: Drafts', 'Deploy is green'].map(noteKind), ['ask', 'ask', 'fail', 'done', 'limit', 'note'])
})
