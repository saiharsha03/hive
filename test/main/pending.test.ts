// messages sent while Claude works survive a close: real store in a temp HIVE_DATA_DIR
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'hive-pending-'))
const p = await import('../../src/main/pending')

const clear = () => { for (const x of p.takePending()) p.threadClosed(x.tabId) }

test('kept until delivered; steers go when their turn ends; a new thread learns its session', () => {
  const base = { cwd: 'C:/repo', title: 'T', sessionId: null }
  p.addPending({ ...base, key: 'q1', tabId: 'a', text: 'queued one', mode: 'queue' })
  p.addPending({ ...base, tabId: 'a', text: 'steer one', mode: 'steer', background: false })
  p.addPending({ ...base, key: 'q2', tabId: 'b', text: 'other thread', mode: 'queue' })
  p.pendingDelivered('q1')
  p.steersDelivered('b') // b has no steers: nothing goes
  p.pendingSession('a', 'sess-a')
  const left = p.takePending()
  assert.deepEqual(left.map((x) => [x.tabId, x.text, x.sessionId, x.background]), [['a', 'steer one', 'sess-a', false], ['b', 'other thread', null, undefined]])
  // a thread closed on purpose drops its unsent messages
  clear()
  p.addPending({ ...base, tabId: 'c', text: 'x', mode: 'queue' })
  p.threadClosed('c')
  assert.deepEqual(p.takePending(), [])
})

test('resent messages stay on disk until their thread\'s turn ends, so a second close loses none', () => {
  clear()
  const base = { cwd: 'C:/repo', title: 'T', sessionId: null }
  p.addPending({ ...base, key: 'r1', tabId: 'r', text: 'queued before the close', mode: 'queue' })
  assert.equal(p.takePending().length, 1) // resent at start...
  assert.deepEqual(p.takePending().map((x) => [x.key, x.mode]), [['r1', 'steer']]) // ...still there, now as a steer of r
  p.steersDelivered('r') // r's turn ended
  assert.deepEqual(p.takePending(), [])
})

test('pictures are kept as files, named in the resent text, and removed once delivered', () => {
  clear()
  const base = { cwd: 'C:/repo', title: 'T', sessionId: null, tabId: 'p', mode: 'queue' as const }
  const png = { mediaType: 'image/png', data: Buffer.from('png!').toString('base64') }
  p.addPending({ ...base, key: 'k1', text: 'look', pictures: [png] })
  p.addPending({ ...base, key: 'k2', text: '', pictures: [{ mediaType: 'image/jpeg', data: Buffer.from('jpg!').toString('base64') }] })
  const first = p.takePending()[0].images![0]
  p.pendingDelivered('k1')
  assert.ok(!existsSync(first)) // delivered: its picture file is gone
  const [left] = p.takePending()
  const pic = left.images![0]
  assert.ok(pic.endsWith('k2-0.jpg') && readFileSync(pic, 'utf8') === 'jpg!')
  assert.equal(p.resendText(left), `(Attached images, saved when Hive closed: ${pic})`)
})

test('resend: one prompt per thread with all its messages, in order', () => {
  clear()
  const base = { cwd: 'C:/repo', title: 'T', sessionId: null, mode: 'queue' as const }
  p.addPending({ ...base, key: 'g1', tabId: 'x', text: 'first' })
  p.addPending({ ...base, key: 'g2', tabId: 'y', text: 'other' })
  p.addPending({ ...base, key: 'g3', tabId: 'x', text: 'second' })
  const g = p.resendGroups(p.takePending())
  assert.deepEqual(g.map((x) => [x.tabId, x.prompt]), [['x', 'first\n\n---\n\nsecond'], ['y', 'other']])
})

test('"Send now" keeps the message until the turn it rides ends', () => {
  clear()
  p.addPending({ cwd: 'C:/repo', title: 'T', sessionId: null, key: 's1', tabId: 's', text: 'now please', mode: 'queue' })
  p.pendingIsSteer('s1')
  assert.deepEqual(p.takePending().map((x) => [x.key, x.mode]), [['s1', 'steer']])
  p.steersDelivered('s')
  assert.deepEqual(p.takePending(), [])
})
