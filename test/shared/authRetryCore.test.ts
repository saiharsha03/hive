// a sign-in failure is retried once on a fresh process, and its line is said once
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { AUTH_RETRY_GAP_MS, authRetryDue, dropEcho, isAuthFailure, resultText } from '../../src/shared/authRetryCore'

const WHY = 'Failed to authenticate: OAuth session expired and could not be refreshed'

test('which failures are sign-in failures', () => {
  assert.equal(isAuthFailure(WHY), true)
  assert.equal(isAuthFailure('API Error: 401 {"type":"error","error":{"type":"authentication_error"}}'), true)
  assert.equal(isAuthFailure('OAuth token has been revoked. Please run /login'), true)
  assert.equal(isAuthFailure('You have hit your usage limit'), false)
  assert.equal(isAuthFailure('exit code 1'), false)
})

test('one retry within the gap', () => {
  assert.equal(authRetryDue(WHY, undefined, 1000), true)
  assert.equal(authRetryDue(WHY, 1000, 1000 + AUTH_RETRY_GAP_MS), false)
  assert.equal(authRetryDue(WHY, 1000, 1001 + AUTH_RETRY_GAP_MS), true)
  assert.equal(authRetryDue('overloaded', undefined, 1000), false)
  assert.equal(resultText({ errors: ['a', 3], result: 'b' }), ['a', 'b'].join(String.fromCharCode(10)))
})

test('the failure is said once', () => {
  const items = [{ kind: 'user', text: 'hi' }, { kind: 'assistant', text: WHY }]
  assert.deepEqual(dropEcho(items, WHY), [items[0]])
  assert.deepEqual(dropEcho(items, 'something else'), items)
  assert.equal(dropEcho([{ kind: 'assistant', text: 'A real answer' }], WHY).length, 1)
  assert.deepEqual(dropEcho([], WHY), [])
  assert.deepEqual(dropEcho(items, ''), items)
})
