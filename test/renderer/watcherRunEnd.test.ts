// a background turn that ends leaves its thread waiting ("Finished: ..."); a watcher's scheduled run does not,
// it waits only when it says so
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { onSessionEvent } from '../../src/renderer/src/background'
import type { Session } from '../../src/renderer/src/chat'

const s = (id: string): Session => ({
  id, title: id, items: [{ kind: 'assistant', text: 'All green.\nDetails follow.' }], streaming: '', busy: true, loaded: true, background: true,
})
const done = { type: 'result', is_error: false }

test('a background thread whose turn ends waits with its first line', () => {
  const next = onSessionEvent(s('new-1'), done, null, 5)
  assert.equal(next.waitingReason, 'Finished: All green.')
  assert.equal(next.waitingSince, 5)
})

test('a watcher run that ends is not marked waiting', () => {
  const next = onSessionEvent(s('watcher-deploy-health-1700000000000'), done, null, 5)
  assert.equal(next.busy, false)
  assert.equal(next.waitingReason, undefined)
  assert.equal(next.waitingSince, undefined)
})

test('a watcher run that fails still shows as failed', () => {
  const next = onSessionEvent(s('watcher-deploy-health-1700000000000'), { type: 'result', is_error: true, result: 'boom' }, null, 5)
  assert.equal(next.waitingReason, 'Failed: boom')
})
