import { test } from 'vitest'
import assert from 'node:assert/strict'
import { addTodo, formatTodos, openMajor, parseTodos, updateTodo, type Todo } from '../../src/shared/teamTodoCore'

const names: Record<string, string> = { lead: 'Lead', b1: 'Builder API', qa: 'QA' }
const name = (id: string) => names[id] ?? id

test('board and personal to-dos: add, check off, ownership, open majors', () => {
  let t: Todo[] = []
  t = addTodo(t, { text: 'Backfill tracker accounts', major: true, owner: 'b1', by: 'lead', at: 0 })
  t = addTodo(t, { text: 'Click through pipeline page', major: true, owner: '', by: 'lead', at: 0 })
  t = addTodo(t, { text: 'Write the migration', major: false, owner: 'b1', by: 'b1', at: 0 })
  assert.deepEqual(t.map((x) => x.id), ['T1', 'T2', 'T3'])
  assert.equal(openMajor(t).length, 2)
  assert.match(String(updateTodo(t, 'T1', 'qa', 'lead', { state: 'done' }, 5)), /belongs to someone else/)
  const u = updateTodo(t, 't1', 'b1', 'lead', { state: 'done', note: 'in 41d71bf' }, 5) as Todo[]
  assert.deepEqual([u[0].state, u[0].doneAt, u[0].note], ['done', 5, 'in 41d71bf'])
  const v = updateTodo(u, 'T2', 'qa', 'lead', { state: 'doing', owner: 'qa' }, 6) as Todo[] // unassigned: anyone may take it
  assert.deepEqual([v[1].state, v[1].owner], ['doing', 'qa'])
  assert.equal(openMajor(v).length, 1)
  const text = formatTodos(v, name)
  assert.match(text, /Team board \(1 open of 2\):\n\[x\] T1 Backfill tracker accounts \(owner: Builder API\) - in 41d71bf\n\[~\] T2 Click through pipeline page \(owner: QA\)/)
  assert.match(text, /Builder API \(1 open\):\n\[ \] T3 Write the migration/)
  assert.equal(updateTodo(v, 'T9', 'lead', 'lead', {}, 0), 'No to-do T9.')
  assert.equal(parseTodos(JSON.stringify(v)).length, 3)
  assert.deepEqual(parseTodos('nope'), [])
})
