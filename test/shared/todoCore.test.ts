import { test } from 'vitest'
import assert from 'node:assert/strict'
import { addDays, dueLabel, groupTodos, parseQuickAdd, todoBadge, type TodoItem } from '../../src/shared/todoCore'

const TODAY = '2026-10-30' // a Friday

test('no phrase: text kept, no due', () => {
  assert.deepEqual(parseQuickAdd('  call the   vendor ', TODAY), { text: 'call the vendor' })
  assert.deepEqual(parseQuickAdd('review 3 PRs', TODAY), { text: 'review 3 PRs' })
  assert.deepEqual(parseQuickAdd('', TODAY), { text: '' })
})
test('today / tomorrow and short forms', () => {
  assert.deepEqual(parseQuickAdd('ship it today', TODAY), { text: 'ship it', due: '2026-10-30' })
  assert.deepEqual(parseQuickAdd('ship it tomorrow', TODAY), { text: 'ship it', due: '2026-10-31' })
  assert.deepEqual(parseQuickAdd('ship it Tmrw', TODAY), { text: 'ship it', due: '2026-10-31' })
})
test('weekdays: the next one after today, a week out for the same weekday', () => {
  assert.equal(parseQuickAdd('a mon', TODAY).due, '2026-11-02')
  assert.equal(parseQuickAdd('a Sat', TODAY).due, '2026-10-31')
  assert.equal(parseQuickAdd('a thursday', TODAY).due, '2026-11-05')
  assert.equal(parseQuickAdd('a thurs', TODAY).due, '2026-11-05')
  assert.equal(parseQuickAdd('a fri', TODAY).due, '2026-11-06')
})
test('M/D dates: this year, next year once passed, explicit year, invalid ignored', () => {
  assert.deepEqual(parseQuickAdd('renewal 11/05', TODAY), { text: 'renewal', due: '2026-11-05' })
  assert.equal(parseQuickAdd('x 10/30', TODAY).due, '2026-10-30')
  assert.equal(parseQuickAdd('x 1/3', TODAY).due, '2027-01-03')
  assert.equal(parseQuickAdd('x 1/3/2026', TODAY).due, '2026-01-03')
  assert.equal(parseQuickAdd('x 2/1/27', TODAY).due, '2027-02-01')
  assert.deepEqual(parseQuickAdd('x 2/30', TODAY), { text: 'x 2/30' })
  assert.deepEqual(parseQuickAdd('x 13/1', TODAY), { text: 'x 13/1' })
  assert.equal(parseQuickAdd('x 2/29', '2027-03-01').due, '2028-02-29')
})
test('optional by / due / on before the phrase', () => {
  assert.deepEqual(parseQuickAdd('send the deck by fri', TODAY), { text: 'send the deck', due: '2026-11-06' })
  assert.deepEqual(parseQuickAdd('send the deck due 11/05', TODAY), { text: 'send the deck', due: '2026-11-05' })
  assert.deepEqual(parseQuickAdd('meet on mon', TODAY), { text: 'meet', due: '2026-11-02' })
})
test('only the last word counts; a lone phrase stays the text', () => {
  assert.deepEqual(parseQuickAdd('tomorrow', TODAY), { text: 'tomorrow' })
  assert.deepEqual(parseQuickAdd('by fri', TODAY), { text: 'by fri' })
  assert.deepEqual(parseQuickAdd('fri plan the week', TODAY), { text: 'fri plan the week' })
  assert.deepEqual(parseQuickAdd('monday.com cleanup', TODAY), { text: 'monday.com cleanup' })
})

const t = (id: string, status: TodoItem['status'], due?: string, createdAt = 1, doneAt?: number): TodoItem => ({ id, text: id, status, due, createdAt, doneAt })
test('groups: order, membership and sorting', () => {
  const list = [
    t('later-undated-old', 'todo', undefined, 1), t('later-undated-new', 'todo', undefined, 5), t('later-dated', 'todo', '2026-11-20'),
    t('over2', 'todo', '2026-10-29'), t('over1', 'todo', '2026-10-01'), t('today', 'todo', TODAY),
    t('week-edge', 'todo', addDays(TODAY, 6)), t('week1', 'todo', '2026-10-31'), t('just-later', 'todo', addDays(TODAY, 7)),
    t('talk-late', 'talk', '2026-10-01'), t('hold', 'holding'), t('done-a', 'done', undefined, 1, 10), t('done-b', 'done', undefined, 1, 20),
  ]
  const g = groupTodos(list, TODAY)
  assert.deepEqual(g.map((x) => x.key), ['overdue', 'today', 'week', 'later', 'talk', 'holding', 'done'])
  const ids = Object.fromEntries(g.map((x) => [x.key, x.items.map((i) => i.id)]))
  assert.deepEqual(ids.overdue, ['over1', 'over2'])
  assert.deepEqual(ids.today, ['today'])
  assert.deepEqual(ids.week, ['week1', 'week-edge'])
  assert.deepEqual(ids.later, ['just-later', 'later-dated', 'later-undated-new', 'later-undated-old'])
  assert.deepEqual(ids.talk, ['talk-late'])
  assert.deepEqual(ids.holding, ['hold'])
  assert.deepEqual(ids.done, ['done-b', 'done-a'])
  assert.equal(g.reduce((n, x) => n + x.items.length, 0), list.length)
  assert.equal(g[0].label, 'Overdue')
})
test('groups: empty groups left out', () => {
  assert.deepEqual(groupTodos([], TODAY), [])
  assert.deepEqual(groupTodos([t('a', 'holding')], TODAY).map((x) => x.key), ['holding'])
})
test('badge: open = todo + talk; late only for open items past due', () => {
  assert.deepEqual(todoBadge([t('a', 'todo'), t('b', 'talk'), t('c', 'holding'), t('d', 'done', '2026-01-01')], TODAY), { open: 2, late: false })
  assert.deepEqual(todoBadge([t('a', 'talk', '2026-10-29')], TODAY), { open: 1, late: true })
  assert.deepEqual(todoBadge([t('a', 'holding', '2026-10-29'), t('b', 'todo', TODAY)], TODAY), { open: 1, late: false })
})
test('due labels', () => {
  assert.equal(dueLabel(TODAY, TODAY), 'Today')
  assert.equal(dueLabel('2026-10-31', TODAY), 'Tomorrow')
  assert.equal(dueLabel('2026-10-29', TODAY), 'Yesterday')
  assert.equal(dueLabel('2026-11-03', TODAY), 'Tue')
  assert.equal(dueLabel('2026-11-20', TODAY), 'Nov 20')
  assert.equal(dueLabel('2027-01-03', TODAY), 'Jan 3, 2027')
  assert.equal(dueLabel('2026-11-02', '2026-10-31'), 'Mon') // across the DST change
})
