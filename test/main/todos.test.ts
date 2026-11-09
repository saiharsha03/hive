// round trip through the real store on a temp file (HIVE_TODOS_FILE), never ~/.claude/hive-todos.json
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../../src/main/todos'

const dir = mkdtempSync(join(tmpdir(), 'hive-todos-'))
const file = join(dir, 'hive-todos.json')
process.env.HIVE_TODOS_FILE = file
const real = join(homedir(), '.claude', 'hive-todos.json')
const realBefore = existsSync(real) ? readFileSync(real, 'utf8') : null
const raw = () => JSON.parse(readFileSync(file, 'utf8'))

test('missing file is an empty list', async () => { assert.deepEqual(await store.listTodos(), []) })

test('add, edit, due, status, done, delete, restore round trip in the file format', async () => {
  // an item in the old format, written by another tool, kept as-is
  writeFileSync(file, JSON.stringify([{ id: 'old', text: 'old one', done: true, createdAt: 1, doneAt: 3, source: 'claude' }]))
  const a = await store.addTodo('call vendor', 'user', { due: '2026-11-06' })
  const b = await store.addTodo('talk about pricing', 'user', { status: 'talk' })
  let f = raw()
  assert.equal(f.length, 3)
  assert.deepEqual(Object.keys(f[1]).sort(), ['createdAt', 'done', 'due', 'id', 'source', 'status', 'text'])
  assert.equal(f[0].status, 'done'); assert.equal(f[0].doneAt, 3)
  assert.ok(readFileSync(file, 'utf8').endsWith('\n'))

  await store.editTodo(a.id, '  call the vendor ')
  await store.setDue(a.id, null)
  await store.setStatus(b.id, 'holding')
  await store.setDone(a.id, true)
  f = raw()
  assert.equal(f[1].text, 'call the vendor'); assert.ok(!('due' in f[1]))
  assert.equal(f[1].status, 'done'); assert.equal(f[1].done, true); assert.equal(typeof f[1].doneAt, 'number')
  assert.equal(f[2].status, 'holding'); assert.equal(f[2].done, false)
  await store.setDone(a.id, false)
  f = raw(); assert.equal(f[1].status, 'todo'); assert.ok(!('doneAt' in f[1]))

  const before = raw()
  const gone = (await store.listTodos())[1]
  await store.deleteTodo(gone.id)
  assert.equal(raw().length, 2)
  await store.restoreTodo(gone, 1)
  assert.deepEqual(raw(), before)
  await store.restoreTodo(gone, 1) // a second undo does not duplicate
  assert.equal(raw().length, 3)
  assert.ok(!existsSync(`${file}.hive-tmp`))
})

test('bad dates and bad files are refused, the file is not overwritten', async () => {
  await assert.rejects(store.setDue((await store.listTodos())[0].id, 'Friday'))
  writeFileSync(file, '{ not json')
  await assert.rejects(store.addTodo('x', 'user'), /not valid JSON/)
  assert.equal(readFileSync(file, 'utf8'), '{ not json')
  writeFileSync(file, '{"a":1}')
  await assert.rejects(store.listTodos(), /not a list/)
})

test('watcher fires once (debounced) for writes to the list and ignores other files', async () => {
  writeFileSync(file, '[]\n')
  let n = 0
  const stop = store.watchTodos(() => n++, 100)
  await new Promise((r) => setTimeout(r, 100))
  writeFileSync(join(dir, 'other.json'), '{}')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(n, 0, 'other files ignored')
  await store.addTodo('from the agent', 'claude') // temp file + rename
  writeFileSync(file, JSON.stringify(raw())) // a plain overwrite, as another writer might do
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(n, 1)
  stop()
})

test('the real list was not touched', () => {
  assert.equal(existsSync(real) ? readFileSync(real, 'utf8') : null, realBefore)
})
