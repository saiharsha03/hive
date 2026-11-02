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

test('phone requests: run once while fresh; replays silent; stale remembered without moving the floor', async () => {
  const { checkPhoneSeq } = await import('../../src/main/mobile')
  const now = 1_000_000_000
  let r = { seqIn: 0, seen: [] as number[] }
  const step = (seq: number, at = now) => { const c = checkPhoneSeq(r, seq, at); r = c.next; return c.verdict }
  assert.equal(step(now - 1000), 'ok')
  assert.equal(step(now - 1000), 'replay') // the same blob again
  assert.equal(step(now - 500), 'ok') // a later one; an earlier-but-unseen one in the window still runs too
  assert.equal(step(now - 900), 'ok')
  // held back an hour by the relay: refused once, then silent
  assert.equal(step(now - 3_600_000 + 10, now), 'replay') // below the floor already
  // phone clock an hour ahead: stale, and the floor does not jump, so normal requests keep working
  assert.equal(step(now + 3_600_000), 'stale')
  assert.equal(step(now + 3_600_000), 'replay')
  assert.equal(step(now - 100), 'ok')
  assert.ok(r.seen.includes(now - 1000)) // the far-future stale seq did not prune the real ones
  // a record from before the seen list: its high-water mark still refuses
  assert.equal(checkPhoneSeq({ seqIn: now }, now - 10, now).verdict, 'replay')
})
