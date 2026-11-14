// a question Orbit asks itself (Quarry's write confirmation) draws a card even though no AskUserQuestion call stands
// behind it; Claude's own question keeps its single row
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { applyEvent, type Session } from '../../src/renderer/src/chat'

const base = (items: Session['items'] = []): Session => ({ id: 't1', title: 't', items, streaming: '', busy: true, loaded: true, background: false })
const questions = [{ header: 'Write', question: 'Run this write on "Orchard demo"?', multiSelect: false, options: [{ label: 'Run it', description: '' }, { label: 'Do not run it', description: '' }] }]

test("Orbit's own question gets a card row; answered, the row ends and the card closes", () => {
  const a = applyEvent(base(), { type: 'hive_ask', id: 'quarry-write-1', questions })
  assert.deepEqual(a.asks, ['quarry-write-1'])
  const row = a.items.at(-1) as { kind: string; id: string; name: string; input: { questions: unknown }; status: string }
  assert.deepEqual([row.kind, row.id, row.name, row.status], ['tool', 'quarry-write-1', 'AskUserQuestion', 'running'])
  assert.deepEqual(row.input.questions, questions)
  const b = applyEvent(a, { type: 'hive_ask_done', id: 'quarry-write-1' })
  assert.deepEqual(b.asks, [])
  assert.equal((b.items.at(-1) as { status: string }).status, 'done')
})

test("Claude's AskUserQuestion already has its row: no second one", () => {
  const withRow = base([{ kind: 'tool', id: 'toolu_1', name: 'AskUserQuestion', input: { questions }, status: 'running' }])
  const a = applyEvent(withRow, { type: 'hive_ask', id: 'toolu_1', questions })
  assert.equal(a.items.length, 1)
  assert.deepEqual(a.asks, ['toolu_1'])
  assert.equal((a.items[0] as { ask?: unknown }).ask, undefined)
})

test('a permission request keeps its question on the call it is for, so the Allow / Deny card can draw', () => {
  const withRow = base([{ kind: 'tool', id: 'toolu_2', name: 'Bash', input: { command: 'ls' }, status: 'running' }])
  const a = applyEvent(withRow, { type: 'hive_ask', id: 'toolu_2', questions })
  assert.equal(a.items.length, 1)
  assert.deepEqual(a.asks, ['toolu_2'])
  assert.deepEqual((a.items[0] as { ask?: unknown }).ask, questions)
  assert.deepEqual(applyEvent(a, { type: 'hive_ask_done', id: 'toolu_2' }).asks, [])
})
