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
  assert.deepEqual(forkPoint(lines, 'u2'), { found: true, at: 'a1', midTurn: false })
  assert.deepEqual(forkPoint(lines, 'u1'), { found: true, at: null, midTurn: false })
  assert.deepEqual(forkPoint(lines, 'nope'), { found: false, at: null, midTurn: false })
  assert.deepEqual(forkPoint('not json\n{bad', 'u2'), { found: false, at: null, midTurn: false })
})

test('a message steered into a running turn (its parent is a tool call or result) is mid-turn', () => {
  const steered = [
    { type: 'user', uuid: 'u1', parentUuid: null },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'tool_use', id: 't1' }] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
    { type: 'user', uuid: 's1', parentUuid: 'r1', message: { content: [{ type: 'text', text: 'also do X' }] } },
    { type: 'user', uuid: 's2', parentUuid: 'a1', message: { content: [{ type: 'text', text: 'steer' }] } },
  ].map((e) => JSON.stringify(e)).join('\n')
  assert.equal(forkPoint(steered, 's1').midTurn, true)
  assert.equal(forkPoint(steered, 's2').midTurn, true)
  // a stopped turn is over: the message after Esc during a tool call, or after a tool call nobody answered, starts a turn
  const stopped = [
    { type: 'user', uuid: 'u1', parentUuid: null },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'tool_use', id: 't1' }] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '[Request interrupted by user for tool use]' }] } },
    { type: 'user', uuid: 'n1', parentUuid: 'r1', message: { content: [{ type: 'text', text: 'try again' }] } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'n1', message: { content: [{ type: 'tool_use', id: 't2' }] } },
    { type: 'user', uuid: 'n2', parentUuid: 'a2', message: { content: [{ type: 'text', text: 'after a crash' }] } },
  ].map((e) => JSON.stringify(e)).join('\n')
  assert.equal(forkPoint(stopped, 'n1').midTurn, false)
  assert.equal(forkPoint(stopped, 'n2').midTurn, false)
  assert.equal(forkPoint(lines, 'u2').midTurn, false)
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

test('files a dry run still lists after the restore count as not put back (a missing backup)', () => {
  assert.deepEqual(partialRestore(['a', 'b'], { skippedLinks: 0 }, ['b']), { missing: ['b'], skipped: 0 })
  assert.equal(partialRestore(['a'], { skippedLinks: 0 }, []), null)
})
