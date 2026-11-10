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
  // with its kind and buttons it still fits, and they are kept whole while the text gives way
  const more = { kind: 'ask' as const, ask: { id: 'a'.repeat(40), opts: [{ l: 'x'.repeat(40), open: true as const }, { l: 'y'.repeat(40) }, { l: 'z'.repeat(40) }] } }
  const b = fitNotification('"'.repeat(500), '"\n'.repeat(1500), 't', more)
  assert.ok(Buffer.byteLength(JSON.stringify({ ...b, seq: 1e15, at: 1e15 })) <= 2500)
  assert.deepEqual([b.kind, b.ask], [more.kind, more.ask])
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
  // held back three minutes (or the phone clock behind): not run, and flagged so the app is told why
  assert.deepEqual([checkPhoneSeq({ seqIn: 0 }, now - 3 * 60_000, now).run, checkPhoneSeq({ seqIn: 0 }, now - 3 * 60_000, now).stale], [false, true])
  assert.equal(checkPhoneSeq({ seqIn: now }, now - 3 * 60_000, now).stale, undefined) // a replay of one that ran stays silent
  assert.equal(checkPhoneSeq({ seqIn: 0 }, now - 60_000, now).stale, undefined) // a minute late still runs
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

test('a send or new thread tried again with the same mid runs once and gets the first answer', async () => {
  const { oncePerMid } = await import('../../src/main/mobile')
  let runs = 0
  const run = async () => { runs += 1; return `sent ${runs}` }
  const first = oncePerMid('m-1', run)
  assert.equal(await oncePerMid('m-1', run), 'sent 1') // the retry while the first is still running
  assert.equal(await first, 'sent 1')
  assert.equal(await oncePerMid('m-1', run), 'sent 1') // and after it finished
  assert.equal(runs, 1)
  assert.equal(await oncePerMid('m-2', run), 'sent 2') // another message
  assert.equal(await oncePerMid(undefined, run), 'sent 3') // an older app sends no mid: every request runs
  assert.equal(await oncePerMid(undefined, run), 'sent 4')
  // one that failed did not run, so the retry runs it
  await assert.rejects(oncePerMid('m-3', async () => { throw new Error('The Hive window is not open') }))
  assert.equal(await oncePerMid('m-3', run), 'sent 5')
  // forgotten after ten minutes
  assert.equal(await oncePerMid('m-1', run, Date.now() + 11 * 60_000), 'sent 6')
})
