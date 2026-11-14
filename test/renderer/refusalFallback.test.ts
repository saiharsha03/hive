// a safeguard refusal that re-runs on the fallback model: the refused answer goes, the retry shows, and one note
// says why the model changed (no second "Model changed" note)
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { applyEvent, type Session } from '../../src/renderer/src/chat'

const base = (): Session => ({ id: 't1', title: 't', items: [], streaming: '', busy: true, loaded: true, background: false })
const reply = (uuid: string, model: string, text: string, supersedes?: string[]) =>
  ({ type: 'assistant', uuid, ...(supersedes ? { supersedes } : {}), message: { model, content: [{ type: 'text', text }] } })

test('the refused answer is taken back and the fallback notice says why', () => {
  let s = applyEvent(base(), reply('u0', 'claude-opus-5-5', 'first answer'))
  s = applyEvent(s, reply('u1', 'claude-opus-5-5', 'refused partial'))
  s = applyEvent(s, reply('u2', 'claude-opus-4-8', 'the retried answer', ['u1']))
  s = applyEvent(s, { type: 'system', subtype: 'model_refusal_fallback', trigger: 'refusal', direction: 'retry', scope: 'session',
    original_model: 'claude-opus-5-5', fallback_model: 'claude-opus-4-8', request_id: null, api_refusal_category: 'cyber', retracted_message_uuids: ['u1'] })
  const texts = s.items.map((it) => ('text' in it ? `${it.kind}:${it.text}` : it.kind))
  assert.equal(texts.filter((t) => t.includes('refused partial')).length, 0)
  assert.equal(texts.filter((t) => t.startsWith('note:Model changed')).length, 0)
  assert.equal(texts[0], 'assistant:first answer')
  assert.equal(texts[1], 'assistant:the retried answer')
  assert.match(texts[2], /^note:.*safeguards flagged this request \(cyber\), so it re-ran on .*4\.8.*stays on/i)
})

test('a side request that fell back leaves the thread model alone', () => {
  const s = applyEvent(base(), { type: 'system', subtype: 'model_refusal_fallback', scope: 'local', original_model: 'claude-fable-5-2', fallback_model: 'claude-opus-5', api_refusal_category: null })
  const note = s.items.at(-1) as { kind: string; text: string }
  assert.equal(note.kind, 'note')
  assert.match(note.text, /^A side request was flagged .* this thread's model is unchanged$/)
  assert.equal(s.answeredBy, undefined)
})
