// why a thread is marked waiting: said in the thread at once, until the user's next message
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { markWaiting, needsNote, withNeeds } from '../../src/renderer/src/background'

test('the reason shows even when the thread is on screen, and goes with the next user message', () => {
  const s = { items: [{ kind: 'user' }, { kind: 'text' }] } as never
  const marked = markWaiting(withNeeds(s, ' Approve the migration? '), 'Approve the migration?', 1, true)
  assert.equal(marked.waitingReason, undefined) // on screen: not listed under "need you"
  assert.equal(needsNote(marked), 'Approve the migration?')
  assert.equal(needsNote({ ...marked, items: [...marked.items, { kind: 'text' }] as never }), 'Approve the migration?')
  assert.equal(needsNote({ ...marked, items: [...marked.items, { kind: 'user' }] as never }), '')
  assert.equal(needsNote(withNeeds(s, undefined)), 'Needs your input')
  assert.equal(needsNote(s), '')
})
