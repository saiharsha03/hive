import { test } from 'vitest'
import assert from 'node:assert/strict'
import { historyMatches, isModelKey, stashStep, tabTakes } from '../../src/shared/promptKeysCore'

test('Ctrl+R finds earlier prompts by any part, case not minded, newest first', () => {
  const past = ['run the Tests again', 'fix the login bug', 'run tests']
  assert.deepEqual(historyMatches(past, 'TESTS'), ['run the Tests again', 'run tests'])
  assert.deepEqual(historyMatches(past, '  '), past)
  assert.deepEqual(historyMatches(past, 'deploy'), [])
})

test('Ctrl+S stashes a box with text or pictures and brings it back into an empty box', () => {
  const put = stashStep({ text: 'half a thought', images: ['img'] }, null)
  assert.deepEqual(put, { box: { text: '', images: [] }, stashed: { text: 'half a thought', images: ['img'] } })
  assert.deepEqual(stashStep({ text: '', images: [] }, put!.stashed), { box: { text: 'half a thought', images: ['img'] }, stashed: null })
  assert.equal(stashStep({ text: '  ', images: [] }, null), null)
  // a box with text of its own stashes it (the earlier stash gives way), as in the terminal
  assert.deepEqual(stashStep({ text: 'new', images: [] }, { text: 'old', images: [] })?.stashed, { text: 'new', images: [] })
})

test('Tab: the copied-text hint first, then the suggested prompt in an empty box', () => {
  assert.equal(tabTakes(true, 'run the tests', true), 'clip')
  assert.equal(tabTakes(false, 'run the tests', true), 'suggestion')
  assert.equal(tabTakes(false, 'run the tests', false), null)
  assert.equal(tabTakes(false, '  ', true), null)
  assert.equal(tabTakes(false, null, true), null)
})

test('Alt+P is the model key; Ctrl+Alt+P and Alt+T are not', () => {
  const k = { key: 'p', code: 'KeyP', altKey: true, ctrlKey: false, shiftKey: false }
  assert.equal(isModelKey(k), true)
  assert.equal(isModelKey({ ...k, ctrlKey: true }), false)
  assert.equal(isModelKey({ ...k, key: 't', code: 'KeyT' }), false)
  assert.equal(isModelKey({ ...k, altKey: false }), false)
})
