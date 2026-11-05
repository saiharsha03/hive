// a rewound message's fork point is the chain entry before it; the first message has none
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { forkPoint } from '../../src/shared/rewindCore'

const lines = [
  { type: 'user', uuid: 'u1', parentUuid: null },
  { type: 'assistant', uuid: 'a1', parentUuid: 'u1' },
  { type: 'file-history-snapshot', messageId: 'u2' },
  { type: 'user', uuid: 'u2', parentUuid: 'a1' },
].map((e) => JSON.stringify(e)).join('\n')

test('fork point of a rewound message', () => {
  assert.deepEqual(forkPoint(lines, 'u2'), { found: true, at: 'a1' })
  assert.deepEqual(forkPoint(lines, 'u1'), { found: true, at: null })
  assert.deepEqual(forkPoint(lines, 'nope'), { found: false, at: null })
  assert.deepEqual(forkPoint('not json\n{bad', 'u2'), { found: false, at: null })
})
