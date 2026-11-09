import { test } from 'vitest'
import assert from 'node:assert/strict'
import { insightCallouts } from '../../src/shared/insightCore'

test('a ★ Insight box becomes a quote that starts with the marker; other text is untouched', () => {
  const box = 'Before\n\n`★ Insight ─────────────────────`\n- one point\n- two points\n`─────────────────────────`\n\nAfter'
  assert.equal(insightCallouts(box), 'Before\n\n> **★ Insight**\n>\n> - one point\n> - two points\n\nAfter')
  assert.equal(insightCallouts('plain text with `code`'), 'plain text with `code`')
  // two boxes in one answer
  const two = `${box}\n\n${box}`
  assert.equal(insightCallouts(two).match(/> \*\*★ Insight\*\*/g)?.length, 2)
})
