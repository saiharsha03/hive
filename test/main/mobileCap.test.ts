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

test('phone requests: run once, in order, while fresh; everything else dropped (and nothing is kept for it)', async () => {
  const { checkPhoneSeq } = await import('../../src/main/mobile')
  const now = 1_000_000_000
  assert.equal(checkPhoneSeq(0, now - 1000, now), true)
  assert.equal(checkPhoneSeq(now - 1000, now - 1000, now), false) // the same request again
  assert.equal(checkPhoneSeq(now - 1000, now - 1500, now), false) // an older one (relay reordering or replaying)
  assert.equal(checkPhoneSeq(now - 1000, now - 500, now), true)
  assert.equal(checkPhoneSeq(0, now - 3 * 60_000, now), false) // held back three minutes by the relay
  assert.equal(checkPhoneSeq(0, now + 3 * 60_000, now), false) // phone clock far ahead: refused, and seqIn does not move
  // an upgrade keeps the same record (a high-water mark), so nothing at or below it ever runs again
  assert.equal(checkPhoneSeq(now, now - 10, now), false)
})
