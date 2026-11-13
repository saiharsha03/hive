import { test } from 'vitest'
import assert from 'node:assert/strict'
import { DONE_KEPT_MS, formatTodos, type ListedTodo } from '../../src/shared/todoListCore'

const NOW = new Date('2026-11-12T12:00:00').getTime()
const TODAY = '2026-11-12'
const todo = (over: Partial<ListedTodo>): ListedTodo => ({ id: over.text ?? 'x', text: 'x', status: 'todo', createdAt: NOW - 1000, ...over })

test('open to-dos are listed by status, dated ones first, with overdue and today said', () => {
  const text = formatTodos([
    todo({ text: 'no date', createdAt: 1 }),
    todo({ text: 'late', due: '2026-11-10' }),
    todo({ text: 'due today', due: TODAY }),
    todo({ text: 'ask Sam', status: 'talk' }),
    todo({ text: 'parked', status: 'holding', due: '2026-12-01' }),
    todo({ text: 'finished', status: 'done', doneAt: NOW - 1000 }),
  ], { now: NOW, today: TODAY })
  assert.equal(text, [
    'To do (3):', '- late (due 2026-11-10, overdue)', '- due today (due 2026-11-12, today)', '- no date', '',
    'Need to talk (1):', '- ask Sam', '',
    'Holding (1):', '- parked (due 2026-12-01)', '',
    '5 open, 1 overdue.',
  ].join('\n'))
})

test('done items only when asked for, and only recent ones; an empty list says so', () => {
  const list = [todo({ text: 'recent', status: 'done', doneAt: NOW - 1000 }), todo({ text: 'old', status: 'done', doneAt: NOW - DONE_KEPT_MS - 1 })]
  assert.equal(formatTodos(list, { now: NOW, today: TODAY }), 'No open to-dos.')
  assert.equal(formatTodos(list, { done: true, now: NOW, today: TODAY }), ['Done (1):', '- recent', '', '0 open, 1 done in the last 14 days.'].join('\n'))
  assert.equal(formatTodos([], { done: true, now: NOW, today: TODAY }), 'The to-do list is empty.')
  // a line break inside a to-do does not break the list
  assert.match(formatTodos([todo({ text: 'two\nlines' })], { now: NOW, today: TODAY }), /^To do \(1\):\n- two lines\n/)
})
