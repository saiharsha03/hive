// the Stop hook's text: nothing when the run saved (and, self-scheduled, set its next wake); else what is missing
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { saveReminder } from '../../src/shared/watcherSaveCore'

test('save reminder names only what is missing', () => {
  assert.equal(saveReminder({ saved: true, selfScheduled: false, nextWake: false }), null)
  assert.equal(saveReminder({ saved: true, selfScheduled: true, nextWake: true }), null)
  const both = saveReminder({ saved: false, selfScheduled: true, nextWake: false })!
  assert.match(both, /save what the next run needs.*, and schedule your next wake-up/)
  assert.match(both, /next run starts a fresh one that knows only what is on disk/)
  assert.doesNotMatch(saveReminder({ saved: false, selfScheduled: false, nextWake: false })!, /schedule/)
  assert.doesNotMatch(saveReminder({ saved: true, selfScheduled: true, nextWake: false })!, /save what/)
})
