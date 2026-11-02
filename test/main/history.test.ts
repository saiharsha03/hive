// a long transcript opens with its recent end only; the full history is still there on request
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHistory, loadRecentHistory } from '../../src/main/history'

const line = (i: number) => JSON.stringify({ type: 'user', message: { role: 'user', content: `message ${i} ${'x'.repeat(80)}` } })

test('recent history: the last bytes from a whole line on, and whether there is more', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hive-history-')), 's.jsonl')
  writeFileSync(file, Array.from({ length: 200 }, (_, i) => line(i)).join('\n') + '\n')
  const all = await loadHistory(file)
  assert.equal(all.length, 200)
  const recent = await loadRecentHistory(file, 2000, 10)
  assert.equal(recent.more, true)
  assert.ok(recent.items.length > 5 && recent.items.length < 30, String(recent.items.length))
  // the newest message is there, and every item is a whole message (no cut line)
  assert.match((recent.items.at(-1) as { text: string }).text, /^message 199 /)
  for (const it of recent.items) assert.match((it as { text: string }).text, /^message \d+ x{80}$/)
  // a small transcript is read whole
  assert.deepEqual(await loadRecentHistory(file, 10 * 1024 * 1024), { items: all, more: false })
  assert.deepEqual(await loadRecentHistory(join(tmpdir(), 'no-such-file.jsonl')), { items: [], more: false })
})
