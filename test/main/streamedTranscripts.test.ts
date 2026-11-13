// whole transcripts are read line by line: the history and a rewind's fork point come out as from the whole text
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHistory, parseHistory } from '../../src/main/history'
import { forkPointOfFile } from '../../src/main/rewindFile'
import { forkPoint } from '../../src/shared/rewindCore'

const dir = mkdtempSync(join(tmpdir(), 'hive-stream-'))
const file = (name: string, entries: object[], tail = '') => {
  const f = join(dir, name)
  writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\r\n') + '\n' + tail)
  return f
}

test('loadHistory streamed = parseHistory of the whole text (tools, Codex, compaction, CRLF, a cut last line)', async () => {
  const entries = [
    { type: 'user', uuid: 'u1', timestamp: '2026-11-01T10:00:00Z', message: { role: 'user', content: 'start' } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a b' }] } },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'c1', name: 'mcp__orbit__codex', input: { task: 'review' } }] } },
    { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' } },
    { type: 'assistant', message: { id: 'm3', content: [{ type: 'text', text: 'done' }] } },
  ]
  const f = file('h.jsonl', entries, '{"type":"user","message":{"content":"cut of')
  const whole = parseHistory(entries.map((e) => JSON.stringify(e)).join('\n') + '\n{"type":"user","message":{"content":"cut of')
  assert.deepEqual(await loadHistory(f), whole)
  assert.ok(whole.some((i) => i.kind === 'codex' && i.status === 'error')) // never answered: stopped
  assert.deepEqual(await loadHistory(join(dir, 'missing.jsonl')), [])
})

test('a transcript from before the rename (mcp__hive__ tools) reads as the orbit tools', () => {
  const old = [
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 's1', name: 'mcp__hive__show_to_user', input: { path: 'C:/a.png' } }, { type: 'tool_use', id: 'c1', name: 'mcp__hive__codex', input: { task: 'review' } }] } },
  ]
  const items = parseHistory(old.map((e) => JSON.stringify(e)).join('\n'))
  assert.ok(items.some((i) => i.kind === 'show' && i.path === 'C:/a.png'))
  assert.ok(items.some((i) => i.kind === 'codex' && i.task === 'review'))
  assert.deepEqual(items.filter((i) => i.kind === 'tool').map((i) => (i as { name: string }).name), ['mcp__orbit__show_to_user', 'mcp__orbit__codex'])
})

test('the fork point read from the file = forkPoint of the whole transcript', async () => {
  const cases: [object[], string[]][] = [
    [[
      { type: 'user', uuid: 'u1', parentUuid: null },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u1' },
      { type: 'file-history-snapshot', messageId: 'u2' },
      { type: 'user', uuid: 'u2', parentUuid: 'a1' },
    ], ['u1', 'u2', 'nope']],
    [[
      { type: 'user', uuid: 'u1', parentUuid: null },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'tool_use', id: 't1' }] } },
      { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
      { type: 'user', uuid: 's1', parentUuid: 'r1', message: { content: [{ type: 'text', text: 'also do X' }] } },
      { type: 'user', uuid: 's2', parentUuid: 'a1', message: { content: [{ type: 'text', text: 'steer, mentions "parentUuid":"u1" in text' }] } },
    ], ['s1', 's2', 'r1']],
    [[
      { type: 'user', uuid: 'u1', parentUuid: null },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'tool_use', id: 't1' }] } },
      { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '[Request interrupted by user for tool use]' }] } },
      { type: 'user', uuid: 'n1', parentUuid: 'r1', message: { content: [{ type: 'text', text: 'try again' }] } },
      { type: 'assistant', uuid: 'a2', parentUuid: 'n1', message: { content: [{ type: 'tool_use', id: 't2' }] } },
      { type: 'user', uuid: 'n2', parentUuid: 'a2', message: { content: [{ type: 'text', text: 'after a crash' }] } },
    ], ['n1', 'n2']],
  ]
  let i = 0
  for (const [entries, ids] of cases) {
    const f = file(`r${i++}.jsonl`, entries)
    const text = entries.map((e) => JSON.stringify(e)).join('\n')
    for (const id of ids) assert.deepEqual(await forkPointOfFile(f, id), forkPoint(text, id), `${f} ${id}`)
  }
  assert.deepEqual(await forkPointOfFile(join(dir, 'missing.jsonl'), 'u1'), { found: false, at: null, midTurn: false })
})
