// a rewound message's fork point is the chain entry before it; the first message has none
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { forkPoint, partialRestore, rewindBlock } from '../../src/shared/rewindCore'

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

test('rewind is refused while the thread or its background work runs', () => {
  const idle = { busy: false, runningTasks: [], codexRuns: 0, rewinding: false }
  assert.equal(rewindBlock(idle), null)
  assert.match(rewindBlock({ ...idle, busy: true })!, /working/)
  assert.match(rewindBlock({ ...idle, runningTasks: ['tests'] })!, /tests/)
  assert.match(rewindBlock({ ...idle, codexRuns: 1 })!, /Codex/)
  assert.match(rewindBlock({ ...idle, rewinding: true })!, /already/)
})

test('a partial file restore lists what was left', () => {
  assert.equal(partialRestore(['a', 'b'], { filesChanged: ['a', 'b'] }), null)
  assert.deepEqual(partialRestore(['a', 'b'], { filesChanged: ['a'] }), { missing: ['b'], skipped: 0 })
  assert.deepEqual(partialRestore(['a'], { filesChanged: ['a'], skippedLinks: 2 }), { missing: [], skipped: 2 })
  assert.equal(partialRestore(['a'], { skippedLinks: 0 }), null) // the CLI's real answer: no list, nothing skipped
})
