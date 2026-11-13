// round trip through the real notes store in a temp HIVE_DATA_DIR, never ~/.claude/hive/notes
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filterNotes, noteTitle } from '../../src/shared/notesCore'

process.env.HIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'hive-notes-'))
const store = await import('../../src/main/notes')

test('titles and search', () => {
  assert.equal(noteTitle('\n# Plan for Q4\nbody'), 'Plan for Q4')
  assert.equal(noteTitle('   \n'), 'Untitled')
  const notes = [{ id: 'a', title: 'Groceries', updated: 1, text: 'Groceries\nmilk eggs' }, { id: 'b', title: 'Ideas', updated: 2, text: 'Ideas\nHive notes panel' }]
  assert.deepEqual(filterNotes(notes, 'HIVE panel').map((n) => n.id), ['b'])
  assert.deepEqual(filterNotes(notes, '  ').map((n) => n.id), ['a', 'b'])
})

test('create, update, list newest first, soft delete; ids cannot leave the folder', async () => {
  const dir = store.notesDir()
  assert.ok(dir.startsWith(process.env.HIVE_DATA_DIR!))
  const a = await store.saveNote(null, '# First\none')
  await new Promise((r) => setTimeout(r, 20))
  const b = await store.saveNote(null, 'Second\ntwo')
  assert.notEqual(a, b)
  assert.equal(await store.saveNote(a, '# First\none, edited'), a)
  assert.equal(readFileSync(join(dir, `${a}.md`), 'utf8'), '# First\none, edited')
  const list = await store.listNotes()
  assert.deepEqual(list.map((n) => n.title), ['First', 'Second']) // the edit made First the newest
  await store.deleteNote(b)
  assert.equal(existsSync(join(dir, `${b}.md`)), false)
  assert.equal(readdirSync(join(dir, '_deleted')).length, 1)
  assert.deepEqual((await store.listNotes()).map((n) => n.id), [a])
  await assert.rejects(store.saveNote('../escape', 'x'), /Not a note id/)
})

test('add_note: appends to the note with that title (any case), else makes one', async () => {
  const a = await store.addToNote('Orbit ideas', 'phone app')
  assert.ok(a.created)
  const b = await store.addToNote('hive IDEAS', '- foldable layout')
  assert.deepEqual([b.id, b.created], [a.id, false])
  const n = (await store.listNotes()).find((x) => x.id === a.id)!
  assert.equal(n.text, '# Orbit ideas\n\nphone app\n\n- foldable layout\n')
})

test('add_note: two threads adding to the same note at once both land', async () => {
  await store.addToNote('Race', 'start')
  await Promise.all([store.addToNote('Race', 'one'), store.addToNote('Race', 'two')])
  const n = (await store.listNotes()).find((x) => x.title === 'Race')!
  assert.ok(n.text.includes('one') && n.text.includes('two'))
})
