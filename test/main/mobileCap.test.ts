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

test('phone requests: run once, in order, while fresh; others dropped; future-dated ones always remembered', async () => {
  const { checkPhoneSeq } = await import('../../src/main/mobile')
  const now = 1_000_000_000
  const hour = 3_600_000
  let st: { seqIn: number; refused?: number[]; floor?: number } = { seqIn: 0 }
  const send = (seq: number, at = now) => { const c = checkPhoneSeq(st, seq, at); st = c.next; return c }
  assert.equal(send(now - 1000).run, true)
  assert.equal(send(now - 1000).run, false) // the same request again
  assert.equal(send(now - 1500).run, false) // an older one
  assert.equal(send(now - 500).run, true)
  assert.equal(checkPhoneSeq({ seqIn: 0 }, now - 3 * 60_000, now).run, false) // held back three minutes
  assert.equal(checkPhoneSeq({ seqIn: now }, now - 10, now).run, false) // an older record's high-water mark holds
  // phone clock an hour ahead: refused, the phone told once, and remembered for when it would look fresh
  const f = send(now + hour)
  assert.deepEqual([f.run, f.future], [false, true])
  assert.equal(send(now + hour, now + hour).run, false)
  // 50 waiting: the next future-dated one raises the floor (never evicted, never forgotten), and all are refused
  st = { seqIn: 0 }
  for (let i = 1; i <= 50; i++) send(now + hour + i)
  assert.equal(send(now + hour + 99).next.floor, now + hour + 99)
  assert.equal(send(now - 100).run, false) // full: refuse all
  assert.equal(send(now + hour + 99, now + hour + 99).run, false) // the one that hit the full list, delivered later
  // exactly at the edge of the window, a refused one stays refused (its expiry raises the floor)
  const edge = checkPhoneSeq({ seqIn: 0, refused: [now] }, now, now + 120_000)
  assert.equal(edge.run, false)
  assert.equal(edge.next.floor, now)
  // once the clock passes them, requests run again
  assert.equal(send(now + 2 * hour, now + 2 * hour).run, true)
})
