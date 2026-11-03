// a big or just-compacted thread is offered a fresh one; Not now holds until it grows more or compacts again
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { HANDOFF_AT_DEFAULT, handoffAt, handoffName, handoffRequest, handoffStart, shouldOffer } from '../../src/shared/handoffCore'

test('HIVE_HANDOFF_AT: empty or junk = default, 0 or less = off', () => {
  assert.equal(handoffAt(undefined), HANDOFF_AT_DEFAULT)
  assert.equal(handoffAt(' '), HANDOFF_AT_DEFAULT)
  assert.equal(handoffAt('lots'), HANDOFF_AT_DEFAULT)
  assert.equal(handoffAt('300000'), 300_000)
  assert.equal(handoffAt('0'), 0)
  assert.equal(handoffAt('-5'), 0)
})

test('offered past the size or after a compaction; Not now holds until 100k more or another compaction', () => {
  const at = 200_000
  assert.equal(shouldOffer({ total: 150_000, compactions: 0 }, at), false)
  assert.equal(shouldOffer({ total: 200_000, compactions: 0 }, at), true)
  assert.equal(shouldOffer({ total: 50_000, compactions: 1 }, at), true) // just compacted: small again, still offered
  const dismissed = { total: 210_000, compactions: 0 }
  assert.equal(shouldOffer({ total: 250_000, compactions: 0, dismissed }, at), false)
  assert.equal(shouldOffer({ total: 310_000, compactions: 0, dismissed }, at), true)
  assert.equal(shouldOffer({ total: 60_000, compactions: 1, dismissed: { total: 60_000, compactions: 1 } }, at), false)
  assert.equal(shouldOffer({ total: 60_000, compactions: 2, dismissed: { total: 60_000, compactions: 1 } }, at), true)
  assert.equal(shouldOffer({ total: 900_000, compactions: 0 }, 0), false) // off on size
  assert.equal(shouldOffer({ total: 10, compactions: 1 }, 0), true) // a compaction still offers
})

test('the prompts name the file; the file name is safe', () => {
  assert.match(handoffRequest('C:/h/x.md'), /Write a handoff for the next thread to C:\/h\/x\.md/)
  assert.match(handoffRequest('C:/h/x.md'), /memory/)
  assert.match(handoffStart('Big thread', 'C:/h/x.md'), /"Big thread".*Read the handoff at C:\/h\/x\.md first/)
  assert.equal(handoffName('new-1:2/../x', 5), 'new-1_2_x-5.md')
})
