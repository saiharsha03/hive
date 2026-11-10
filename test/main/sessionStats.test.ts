// the status bar's per-session numbers: read incrementally, the same answer as reading the whole transcript
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionStats, sessionTotals, setStatsSizes, settled, type SessionStats } from '../../src/main/sessionStats'

// the old whole-file reader, as the reference
function reference(text: string): SessionStats & { totals: { input: number; output: number; requests: number } } {
  const out = { model: null as string | null, contextTokens: null as number | null, lastReplyAt: null as number | null, cacheTtlMs: 300_000, startedAt: null as number | null, compactions: 0, totals: { input: 0, output: 0, requests: 0 } }
  let last: string | null = null
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    const at = Date.parse(e.timestamp ?? '')
    if (!out.startedAt && at) out.startedAt = at
    if (e.type === 'system' && e.subtype === 'compact_boundary') out.compactions++
    const m = e.message
    if (e.type !== 'assistant' || !m?.usage || e.isSidechain) continue
    const u = m.usage
    if (m.id !== last) { last = m.id; out.totals.input += u.input_tokens ?? 0; out.totals.output += u.output_tokens ?? 0; out.totals.requests++ }
    out.contextTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    out.model = m.model ?? out.model
    out.lastReplyAt = at || out.lastReplyAt
    const c = u.cache_creation
    if ((c?.ephemeral_1h_input_tokens ?? 0) > 0) out.cacheTtlMs = 3_600_000
    else if ((c?.ephemeral_5m_input_tokens ?? 0) > 0) out.cacheTtlMs = 300_000
  }
  return out
}
const { totals: _t, ...plain } = reference('')
const strip = (r: ReturnType<typeof reference>) => { const { totals: _x, ...rest } = r; return rest }
void plain

let n = 0
const user = (i: number) => JSON.stringify({ type: 'user', timestamp: new Date(Date.UTC(2026, 10, 1, 9, 0, i)).toISOString(), message: { role: 'user', content: `q${i} ${'x'.repeat(200)}` } })
const reply = (i: number, model = 'claude-a') => [0, 1].map((b) => JSON.stringify({
  type: 'assistant', timestamp: new Date(Date.UTC(2026, 10, 1, 9, 1, i)).toISOString(),
  message: { id: `msg-${i}`, model, content: [{ type: 'text', text: `part ${b}` }], usage: { input_tokens: 10 + i, output_tokens: 5, cache_read_input_tokens: 100 * i, cache_creation_input_tokens: i % 3 ? 0 : 50, cache_creation: { ephemeral_1h_input_tokens: i === 4 ? 50 : 0 } } },
}))
const compact = JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-11-01T10:00:00Z' })
const side = JSON.stringify({ type: 'assistant', isSidechain: true, message: { id: 'side', model: 'sub', usage: { input_tokens: 999 } } })
const convo = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => [user(from + k), ...reply(from + k), ...(k % 7 === 3 ? [compact, side] : [])]).flat()

const file = () => join(mkdtempSync(join(tmpdir(), 'hive-stats-')), `s${n++}.jsonl`)

test('appended bytes only: the same numbers as reading it whole, a half-written line waits for its end', async () => {
  const f = file()
  let text = convo(0, 5).join('\n') + '\n'
  writeFileSync(f, text)
  assert.deepEqual(await sessionStats(f), strip(reference(text)))
  const more = convo(5, 9).join('\n') + '\n'
  const cut = 40
  appendFileSync(f, more.slice(0, cut)) // a line in the middle of being written
  text += more.slice(0, cut)
  assert.deepEqual(await sessionStats(f), strip(reference(convo(0, 5).join('\n') + '\n')))
  appendFileSync(f, more.slice(cut))
  text += more.slice(cut)
  assert.deepEqual(await sessionStats(f), strip(reference(text)))
  const t = await sessionTotals(f)
  const r = reference(text)
  assert.deepEqual([t.input, t.output, t.requests, t.complete], [r.totals.input, r.totals.output, r.totals.requests, true])
  // rewritten shorter: read again from the start
  const again = convo(0, 2).join('\n') + '\n'
  writeFileSync(f, again)
  assert.deepEqual(await sessionStats(f), strip(reference(again)))
  assert.deepEqual(await sessionStats(join(tmpdir(), 'no-such-transcript.jsonl')), { model: null, contextTokens: null, lastReplyAt: null, cacheTtlMs: 300_000, startedAt: null, compactions: 0 })
})

test('a big transcript: head and tail at once, the middle in the background; the same numbers once it is done', async () => {
  setStatsSizes(20 * 1024, 4 * 1024)
  try {
    const f = file()
    const lines = convo(0, 120)
    const text = lines.join('\n') + '\n'
    writeFileSync(f, text)
    const ref = reference(text)
    const first = await sessionStats(f)
    assert.equal(first.startedAt, ref.startedAt) // from the head
    assert.equal(first.model, ref.model) // from the tail
    assert.equal(first.contextTokens, ref.contextTokens)
    assert.equal(first.lastReplyAt, ref.lastReplyAt)
    await settled(f)
    assert.deepEqual(await sessionStats(f), strip(ref))
    const t = await sessionTotals(f)
    assert.deepEqual([t.input, t.output, t.requests, t.complete], [ref.totals.input, ref.totals.output, ref.totals.requests, true])
    // and it keeps reading only what is appended
    appendFileSync(f, [user(200), ...reply(200, 'claude-b')].join('\n') + '\n')
    const after = await sessionStats(f)
    assert.equal(after.model, 'claude-b')
    assert.equal(after.compactions, ref.compactions)
  } finally { setStatsSizes(8 * 1024 * 1024, 2 * 1024 * 1024) }
})
