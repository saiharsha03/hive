// the effort picker: every level it offers (xhigh too) goes through; anything else is refused
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { setEffort } from '../../src/main/liveStatus'

test('setEffort takes low to max, xhigh included, and refuses the rest', async () => {
  const applied: unknown[] = []
  const q = { applyFlagSettings: async (s: unknown) => { applied.push(s) } } as any
  for (const l of ['low', 'medium', 'high', 'xhigh', 'max']) await setEffort('tab', q, l)
  assert.deepEqual(applied, ['low', 'medium', 'high', 'xhigh', 'max'].map((effortLevel) => ({ effortLevel })))
  await assert.rejects(setEffort('tab', q, 'extreme'), /not an effort level/)
  assert.equal(applied.length, 5)
})
