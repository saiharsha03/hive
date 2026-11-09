// a compaction shows as work with its own label, even after the turn's result, until its boundary arrives
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { applyEvent, type Session } from '../../src/renderer/src/chat'

test('compacting keeps the thread busy past the result and clears at the boundary', () => {
  let s: Session = { id: 't', title: 'T', items: [], streaming: '', busy: true, loaded: true, background: false }
  s = applyEvent(s, { type: 'result', is_error: true, subtype: 'error', errors: ['[ede_diagnostic] result_type=user stop_reason=tool_use'] })
  assert.equal(s.busy, false)
  assert.match((s.items.at(-1) as any).text, /^The turn stopped before Claude finished .*\[ede_diagnostic\]/)
  s = applyEvent(s, { type: 'system', subtype: 'status', status: 'compacting' })
  assert.ok(s.busy && s.compacting)
  s = applyEvent(s, { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto' } })
  assert.ok(!s.compacting && !s.busy) // started while idle: idle again
  assert.equal((s.items.at(-1) as any).text, 'Conversation auto-compacted to free up context')
})

test('a compaction inside a running turn leaves the turn running', () => {
  let s: Session = { id: 't', title: 'T', items: [], streaming: '', busy: true, loaded: true, background: false }
  s = applyEvent(s, { type: 'system', subtype: 'status', status: 'compacting' })
  s = applyEvent(s, { type: 'system', subtype: 'status', status: null })
  assert.ok(!s.compacting && s.busy)
  s = applyEvent(s, { type: 'result', is_error: false, subtype: 'success' })
  assert.equal(s.busy, false)
})

test('a changed answering model adds one note; the first answer adds none', () => {
  let s: Session = { id: 't', title: 'T', items: [], streaming: '', busy: true, loaded: true, background: false }
  const say = (model: string) => ({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'hi' }] } })
  s = applyEvent(s, say('claude-opus-5-5'))
  s = applyEvent(s, say('claude-opus-5-5'))
  assert.ok(!s.items.some((i) => i.kind === 'note'))
  s = applyEvent(s, say('claude-fable-5-2'))
  const notes = s.items.filter((i) => i.kind === 'note') as any[]
  assert.equal(notes.length, 1)
  assert.equal(notes[0].text, 'Model changed: Opus 5.5 → Fable 5.2')
})
