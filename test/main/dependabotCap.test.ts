// at most HIVE_DEPENDABOT_MAX_REVIEWS review threads work at once (default 3)
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { DEFAULT_MAX_REVIEWS, reviewCap, reviewSlots } from '../../src/main/dependabot'

test('the review cap: a whole number above 0, else 3', () => {
  assert.equal(DEFAULT_MAX_REVIEWS, 3)
  assert.equal(reviewCap({}), 3)
  assert.equal(reviewCap({ HIVE_DEPENDABOT_MAX_REVIEWS: ' 5 ' }), 5)
  for (const bad of ['0', '-2', '2.5', 'many', '']) assert.equal(reviewCap({ HIVE_DEPENDABOT_MAX_REVIEWS: bad }), 3, bad)
})

test('free slots: the cap minus the reviews still working, never below 0', () => {
  assert.equal(reviewSlots(3, 0), 3)
  assert.equal(reviewSlots(3, 2), 1)
  assert.equal(reviewSlots(3, 5), 0)
})
