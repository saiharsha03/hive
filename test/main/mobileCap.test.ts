// a phone notification is cut by bytes, on a character boundary, so the sealed blob fits in one push
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { byteCap } from '../../src/main/mobile'

test('byteCap keeps short text, cuts long text (any script) to the byte limit with an ellipsis', () => {
  assert.equal(byteCap('short', 10), 'short')
  const cjk = '漢'.repeat(1000) // 3 bytes each
  const cut = byteCap(cjk, 1500)
  assert.ok(Buffer.byteLength(cut) <= 1500 && cut.endsWith('…') && !cut.includes('�'))
})

test('a notification fits one push even when JSON escaping grows it (quotes, newlines)', async () => {
  const { fitNotification } = await import('../../src/main/mobile')
  const n = fitNotification('"'.repeat(500), '"\n'.repeat(1500), 't')
  assert.ok(Buffer.byteLength(JSON.stringify({ ...n, seq: 1e15, at: 1e15 })) <= 2500)
  // sealed: 12 nonce + 16 tag, base64 -> well under the relay's 3600 inline limit
  assert.ok(Math.ceil((Buffer.byteLength(JSON.stringify({ ...n, seq: 1e15, at: 1e15 })) + 28) / 3) * 4 <= 3600)
  assert.equal(fitNotification('Hi', 'short', 't').body, 'short')
})

test('phone requests: run once, in order, while fresh; others dropped; future-dated ones remembered (bounded)', async () => {
  const { checkPhoneSeq } = await import('../../src/main/mobile')
  const now = 1_000_000_000
  const run = (seqIn: number, seq: number, at = now, refused: number[] = []) => checkPhoneSeq(seqIn, seq, at, refused)
  assert.equal(run(0, now - 1000).run, true)
  assert.equal(run(now - 1000, now - 1000).run, false) // the same request again
  assert.equal(run(now - 1000, now - 1500).run, false) // an older one
  assert.equal(run(now - 1000, now - 500).run, true)
  assert.equal(run(0, now - 3 * 60_000).run, false) // held back three minutes
  assert.equal(run(now, now - 10).run, false) // an older record's high-water mark holds (upgrades keep it)
  // phone clock an hour ahead: refused and remembered, so the relay cannot deliver it an hour later
  const hour = 3_600_000
  const r = run(0, now + hour)
  assert.deepEqual([r.run, r.refused], [false, [now + hour]])
  assert.equal(run(0, now + hour, now + hour, r.refused).run, false)
  // the list is bounded and forgets entries once they are in the past
  let list: number[] = []
  for (let i = 1; i <= 80; i++) list = run(0, now + hour + i, now, list).refused
  assert.equal(list.length, 50)
  assert.deepEqual(run(0, now - 100, now + 2 * hour, list).refused, [])
})
