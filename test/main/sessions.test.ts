// the sidebar orders threads by their last message, not by when they started or when the file was last touched
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { parse } from '../../src/main/sessions'

const line = (o: object) => JSON.stringify(o)

test('updated = the newest user or assistant message; titles, hooks and meta lines do not count', () => {
  const text = [
    line({ type: 'user', timestamp: '2026-11-01T10:00:00Z', cwd: 'C:/r/app', message: { content: 'start the work' } }),
    line({ type: 'assistant', timestamp: '2026-11-02T09:00:00Z', message: { content: [] } }),
    line({ type: 'user', isMeta: true, timestamp: '2026-11-03T08:00:00Z', message: { content: 'meta' } }),
    line({ type: 'custom-title', customTitle: 'Renamed later', timestamp: '2026-11-03T09:00:00Z' }),
  ].join('\n')
  const s = parse('C:/x/abc.jsonl', text, Date.parse('2026-11-03T09:30:00Z'))!
  assert.equal(s.title, 'Renamed later')
  assert.equal(s.started, Date.parse('2026-11-01T10:00:00Z'))
  assert.equal(s.updated, Date.parse('2026-11-02T09:00:00Z'))
  // no timestamps on messages: the file time
  const bare = parse('C:/x/b.jsonl', line({ type: 'user', message: { content: 'hi' } }), 42)!
  assert.equal(bare.updated, 42)
  // the final entry cut off by the tail chunk: its time is unknown, so the file's time
  const cut = [line({ type: 'user', timestamp: '2026-11-01T10:00:00Z', message: { content: 'start' } }), '{"type":"assistant","timestamp":"2026-11-03T'].join('\n')
  assert.equal(parse('C:/x/c.jsonl', cut, 99)!.updated, 99)
  // a watcher run's thread is marked, so the sidebar keeps it out of the thread list
  assert.equal(parse('C:/x/w.jsonl', line({ type: 'user', message: { content: '[Hive watcher run: Watch]\nRun kind: sweep' } }), 1)!.watcherRun, true)
  assert.equal(parse('C:/x/n.jsonl', line({ type: 'user', message: { content: 'look at the watcher run: later' } }), 1)!.watcherRun, undefined)
  assert.equal(parse('C:/x/p.jsonl', line({ type: 'user', message: { content: '  [Hive watcher run: Watch]\nPlease explain this header' } }), 1)!.watcherRun, undefined) // pasted, indented: a user's thread
})
