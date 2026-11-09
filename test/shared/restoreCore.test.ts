import { test } from 'vitest'
import assert from 'node:assert/strict'
import { keepKnown, tabsToRestore, tabsToSave, withDraft } from '../../src/shared/restoreCore'

const tab = (id: string, more: object = {}) => ({ id, background: false, ...more })

test('tabsToSave keeps saved threads on screen, in tab order, by session id', () => {
  const sessions = [
    tab('a', { sessionId: 'a' }),
    tab('new-1', { sessionId: 's1' }), // a new thread that got its session id
    tab('new-2'), // never sent
    tab('b', { sessionId: 'b', background: true }),
    tab('tool:git', { tool: 'git' }),
    tab('file:x', { file: 'x' }),
    tab('watcher-w', { sessionId: 'w' }),
  ]
  const order = ['new-1', 'new-2', 'tool:git', 'a', 'file:x', 'watcher-w']
  assert.deepEqual(tabsToSave(sessions, order, 'a'), { ids: ['s1', 'a'], focused: 'a' })
  assert.deepEqual(tabsToSave(sessions, order, 'new-2'), { ids: ['s1', 'a'], focused: null })
})

test('tabsToRestore skips gone and watcher-run threads and falls back to the last tab', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'w', watcherRun: true }]
  assert.deepEqual(tabsToRestore({ ids: ['b', 'gone', 'w', 'a'], focused: 'b' }, list), { open: [{ id: 'b' }, { id: 'a' }], focus: 'b' })
  assert.deepEqual(tabsToRestore({ ids: ['b', 'a'], focused: 'gone' }, list).focus, 'a')
  assert.deepEqual(tabsToRestore({ ids: ['gone'], focused: null }, list), { open: [], focus: null })
})

test('withDraft sets text and drops blank drafts', () => {
  const d = withDraft({}, 'a', 'hi')
  assert.deepEqual(d, { a: 'hi' })
  assert.equal(withDraft(d, 'a', 'hi'), d)
  assert.deepEqual(withDraft(d, 'a', '  '), {})
  const none = {}
  assert.equal(withDraft(none, 'a', ''), none)
})

test('keepKnown drops drafts of threads no longer listed', () => {
  assert.deepEqual(keepKnown({ a: '1', b: '2' }, new Set(['a'])), { a: '1' })
})
