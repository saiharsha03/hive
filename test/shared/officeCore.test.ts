import { test } from 'vitest'
import assert from 'node:assert/strict'
import { boardFit, boardOf, bubbleText, chatOf, floorsOf, kindOf, knowledgeNote, markOf, newSince, parsePlan, peopleOf, todoCount, trimQueue } from '../../src/shared/officeCore'
import type { Todo } from '../../src/shared/teamTodoCore'
import type { LogEntry, TeamView } from '../../src/shared/teamCore'

const view = (): TeamView => ({
  team: {
    id: 't1', name: 'Migration', goal: 'Move it', dir: 'C:\\t', createdAt: 0,
    owner: { id: 'own', title: 'Planning' }, lead: { id: 'lead', title: 'Lead' },
    members: [
      { id: 'b2', name: 'Builder Web', role: 'builder', cwd: '', joinedAt: 20 },
      { id: 'b1', name: 'Builder API', role: 'Builder', cwd: '', joinedAt: 10 },
      { id: 'r1', name: 'Rev', role: 'reviewer', cwd: '', joinedAt: 30 },
      { id: 'q1', name: 'QA', role: 'qa', cwd: '', joinedAt: 40 },
    ],
  },
  states: { lead: { state: 'working' }, b1: { state: 'waiting', doing: 'Edit' } },
  log: [], plan: '', knowledge: '', todos: [],
})

test('the room is the Lead then members in join order; no Owner; unknown state is closed', () => {
  const p = peopleOf(view())
  assert.deepEqual(p.map((x) => x.id), ['lead', 'b1', 'b2', 'r1', 'q1'])
  assert.deepEqual(p.map((x) => x.state), ['working', 'waiting', 'closed', 'closed', 'closed'])
  assert.deepEqual(p.map((x) => x.look.kind), ['lead', 'builder', 'builder', 'reviewer', 'qa'])
  assert.notEqual(p[1].look.shirt, p[2].look.shirt)
  assert.notEqual(p[1].look.hat, p[2].look.hat)
  assert.equal(new Set(p.map((x) => x.look.shirt)).size, p.length)
})

test('roles map to looks by keyword', () => {
  assert.deepEqual(['Senior dev', 'test runner', 'QA tester', 'Code reviewer', 'researcher', 'dbt validator'].map(kindOf),
    ['builder', 'validator', 'qa', 'reviewer', 'plain', 'validator'])
})

test('plan table rows become board rows; known states uppercase, others as written', () => {
  const md = '# Plan\n\nGoal: x\n\n| Part | Owner | State | Notes |\n|---|---|---|---|\n| API move | Builder API | working | |\n| **Web** | Builder Web | in review | n |\n| | x | done | |\n\ntext\n'
  assert.deepEqual(parsePlan(md), [
    { part: 'API move', owner: 'Builder API', state: 'WORKING', known: true },
    { part: 'Web', owner: 'Builder Web', state: 'in review', known: false },
  ])
  assert.deepEqual(parsePlan('| Owner | Status | Task |\n|-|-|-|\n| QA | done | Click |'), [{ part: 'Click', owner: 'QA', state: 'DONE', known: true }])
  assert.deepEqual(parsePlan('# x\n\n| Part | Owner | State | Notes |\n|---|---|---|---|\n'), [])
})

test('knowledge note is the last two bullets without the stamp', () => {
  const md = '# Learned\n\n- one (Lead, 2026-11-05 10:00)\n- two (QA, 2026-11-05 10:01)\nplain\n* three (keeps parens) (Rev, 2026-11-05 10:02)\n'
  assert.deepEqual(knowledgeNote(md), ['two', 'three (keeps parens)'])
  assert.deepEqual(knowledgeNote('# Learned\n\n'), [])
})

test('only entries after the mark are new, even with equal timestamps and a trimmed tail', () => {
  const e = (at: number, text: string): LogEntry => ({ at, from: 'x', fromName: 'X', to: [], text })
  const old = [e(1, 'a'), e(2, 'b'), e(2, 'c')]
  const mark = markOf(old)
  assert.deepEqual(mark, { at: 2, n: 2 })
  assert.deepEqual(newSince(mark, old), [])
  assert.deepEqual(newSince(mark, [e(2, 'b'), e(2, 'c'), e(2, 'd'), e(3, 'e')]).map((x) => x.text), ['d', 'e'])
  assert.deepEqual(markOf([]), { at: 0, n: 0 })
})

test('bubbles are one line, cut with three dots; the queue keeps the latest two once past four', () => {
  assert.equal(bubbleText('a\n  b'), 'a b')
  const long = bubbleText('x'.repeat(100))
  assert.equal(long.length, 70)
  assert.ok(long.endsWith('...'))
  assert.deepEqual(trimQueue([1, 2, 3, 4]), [1, 2, 3, 4])
  assert.deepEqual(trimQueue([1, 2, 3, 4, 5]), [4, 5])
})

test('floors hold six desks at most and stay balanced; the board cuts to "+N more"', () => {
  assert.deepEqual(floorsOf(1), [[0]])
  assert.deepEqual(floorsOf(6).map((f) => f.length), [6])
  assert.deepEqual(floorsOf(7).map((f) => f.length), [4, 3])
  assert.deepEqual(floorsOf(11).map((f) => f.length), [6, 5])
  assert.deepEqual(floorsOf(11)[1], [6, 7, 8, 9, 10])
  assert.deepEqual(boardFit(3, 5), { shown: 3, more: 0 })
  assert.deepEqual(boardFit(9, 5), { shown: 4, more: 5 })
})

test('the chat with one member: their posts, posts to them, what you sent and the last reply, newest last', () => {
  const v = view()
  v.log = [
    { at: 1, from: 'lead', fromName: 'Lead', to: ['Builder API'], text: 'take the API' },
    { at: 2, from: 'r1', fromName: 'Rev', to: ['Lead'], text: 'not mine' },
    { at: 3, from: 'b1', fromName: 'Builder API', to: [], text: 'started' },
  ]
  v.states.b1 = { state: 'idle', reply: 'All done', at: 5 }
  const c = chatOf(v, 'b1', [{ at: 4, text: 'how is it going' }])
  assert.deepEqual(c.map((l) => [l.kind, l.head, l.text]), [
    ['to', 'Lead to Builder API', 'take the API'], ['them', 'to the board', 'started'], ['you', 'You', 'how is it going'], ['reply', 'Last reply', 'All done'],
  ])
  assert.deepEqual(chatOf(v, 'lead').map((l) => [l.kind, l.text]), [['them', 'take the API'], ['to', 'not mine']])
})

test('the whiteboard shows the team board of major to-dos when there are any, else the plan', () => {
  const v = view()
  v.plan = '| Part | Owner | State |\n|-|-|-|\n| API | Builder API | doing |'
  assert.equal(boardOf(v).title, 'Plan')
  assert.equal(boardOf(v).rows[0].part, 'API')
  const t = (id: string, state: Todo['state'], major: boolean, owner: string): Todo => ({ id, text: `do ${id}`, major, owner, state, by: 'lead', at: 0 })
  v.todos = [t('T1', 'done', true, 'b1'), t('T2', 'open', true, ''), t('T3', 'doing', true, 'lead'), t('T4', 'dropped', true, 'r1'), t('T5', 'done', false, 'b1'), t('T6', 'open', false, 'b1'), t('T7', 'dropped', false, 'b1')]
  const b = boardOf(v)
  assert.equal(b.title, 'Team board')
  assert.equal(b.count, '1 of 3 done')
  assert.deepEqual(b.rows.map((r) => [r.part, r.owner, r.state, r.mark]), [
    ['do T3', 'Lead', 'DOING', 'doing'], ['do T2', 'unassigned', 'OPEN', 'open'], ['do T1', 'Builder API', 'DONE', 'done'], ['do T4', 'Rev', 'DROPPED', 'dropped'],
  ])
  const p = peopleOf(v)
  assert.equal(p.find((x) => x.id === 'b1')?.todo, '1/2')
  assert.equal(p.find((x) => x.id === 'q1')?.todo, '')
  assert.equal(todoCount([]), '')
})
