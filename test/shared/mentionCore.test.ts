import { test } from 'vitest'
import assert from 'node:assert/strict'
import { filterPaths, insertMention, mentionAt, mentionText, quotePath } from '../../src/shared/mentionCore'

test('mentionAt finds an @ that starts a word', () => {
  assert.deepEqual(mentionAt('look at @src/ap', 15), { start: 8, end: 15, query: 'src/ap' })
  assert.deepEqual(mentionAt('@', 1), { start: 0, end: 1, query: '' })
  assert.deepEqual(mentionAt('a\n@x', 4), { start: 2, end: 4, query: 'x' })
})

test('mentionAt ignores emails, finished words and a caret past a space', () => {
  assert.equal(mentionAt('mail me@x.com', 13), null)
  assert.equal(mentionAt('@src/app ', 9), null)
  assert.equal(mentionAt('no at sign', 5), null)
})

test('mentionAt takes the rest of the word after the caret', () => {
  assert.deepEqual(mentionAt('@abcdef tail', 3), { start: 0, end: 7, query: 'ab' })
})

test('quotePath quotes only paths with whitespace', () => {
  assert.equal(quotePath('C:\\a\\b.txt'), 'C:\\a\\b.txt')
  assert.equal(quotePath('C:\\my docs\\b.txt'), '"C:\\my docs\\b.txt"')
  assert.equal(mentionText('a b.md'), '@"a b.md" ')
})

test('insertMention replaces the @query and puts the caret after the space', () => {
  const m = mentionAt('see @sr please', 7)!
  assert.deepEqual(insertMention('see @sr please', m, 'src/a.ts'), { text: 'see @src/a.ts please', caret: 14 })
  const e = mentionAt('@sr', 3)!
  assert.deepEqual(insertMention('@sr', e, 'src/a.ts'), { text: '@src/a.ts ', caret: 10 })
})

test('filterPaths ranks name prefix, name contains, then path; case-insensitive', () => {
  const paths = ['docs/app.md', 'src/App.tsx', 'src/main/app/x.ts', 'src/zapper.ts', 'a/b.ts']
  assert.deepEqual(filterPaths(paths, 'APP'), ['docs/app.md', 'src/App.tsx', 'src/zapper.ts', 'src/main/app/x.ts'])
  assert.deepEqual(filterPaths(paths, 'main/'), ['src/main/app/x.ts'])
  assert.equal(filterPaths(paths, '').length, 5)
  assert.deepEqual(filterPaths(paths, 'zzz'), [])
})
