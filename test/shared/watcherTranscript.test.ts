// a watcher's session stays read-only under any tab: its first real message is Orbit's run header or a wake-up
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { isWatcherTranscript } from '../../src/shared/readOnlyCore'

const user = (content: unknown, extra: object = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra })

test('a watcher transcript is known by its first user message', () => {
  const head = (first: unknown) => [JSON.stringify({ type: 'queue-operation' }), user('meta', { isMeta: true }), user(first), user('later: [Orbit watcher run: X]')].join('\n')
  assert.equal(isWatcherTranscript(head('[Orbit watcher run: Watch]\nRun kind: sweep')), true)
  assert.equal(isWatcherTranscript(head([{ type: 'text', text: '[Orbit wake-up: Selfie] Now: Monday' }])), true)
  assert.equal(isWatcherTranscript(head('[MyHive watcher run: Deploy health]')), true) // a renamed app
  assert.equal(isWatcherTranscript(head('please check the watcher run: tomorrow')), false)
  assert.equal(isWatcherTranscript(head('fix the [Orbit watcher run: x] header')), false) // only at the very start
  assert.equal(isWatcherTranscript(user('hi') + '\n' + user('[Orbit watcher run: Watch]')), false) // the first message decides
  assert.equal(isWatcherTranscript(''), null) // no user message yet: undecided
  assert.equal(isWatcherTranscript('{"type":"user","message":{"content":"[Orbit watcher run: Wa'), null) // cut off: undecided (read more / fail closed)
})
