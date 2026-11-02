// the queue of messages waiting for Claude's turn to end: an interrupt goes ahead of older queued ones
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { turnQueue } from '../../src/main/queueCore'

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
