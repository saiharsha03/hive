// the queue of messages waiting for Claude's turn to end: an interrupt goes ahead of older queued ones
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { promptNeverChecked, turnQueue } from '../../src/main/queueCore'

test('an interrupt waits ahead of messages queued before it; others keep their order', () => {
  const got: string[] = []
  const q = turnQueue<string>((m) => got.push(m), () => {})
  q.markBusy()
  q.submit('a', 'A')
  q.submit('b', 'B')
  q.submit('i', 'interrupt', true)
  q.turnEnded() // the interrupted turn's result
  assert.deepEqual(got, ['interrupt'])
  q.turnEnded()
  q.turnEnded()
  assert.deepEqual(got, ['interrupt', 'A', 'B'])
})

test('held (a paused team): the interrupted turn does not let the queue go in; release does, once idle', () => {
  const got: string[] = []
  const q = turnQueue<string>((m) => got.push(m), () => {})
  q.markBusy()
  q.submit('a', 'A')
  q.hold(true)
  q.turnEnded()
  assert.deepEqual(got, [])
  assert.equal(q.has('a'), true)
  q.hold(false)
  assert.deepEqual(got, ['A'])
  assert.equal(q.has('a'), false)
})

test('a held queue takes a message even when idle, and hands it over on release', () => {
  const got: string[] = []
  const q = turnQueue<string>((m) => got.push(m), () => {})
  q.hold(true)
  q.submit('1', 'while paused')
  assert.deepEqual(got, [])
  assert.equal(q.isHeld(), true)
  q.hold(false)
  assert.deepEqual(got, ['while paused'])
})

test('a turn stopped before its prompt was checked is told apart from other errors and interrupts', () => {
  assert.equal(promptNeverChecked({ subtype: 'error_during_execution', errors: ['prompt_check: the turn was stopped before its prompt was checked'] }), true)
  assert.equal(promptNeverChecked({ subtype: 'error_during_execution', errors: ['aborted'] }), false)
  assert.equal(promptNeverChecked({ subtype: 'success' }), false)
})
