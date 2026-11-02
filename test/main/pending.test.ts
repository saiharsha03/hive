// messages sent while Claude works survive a close: real store in a temp HIVE_DATA_DIR
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'hive-pending-'))
const p = await import('../../src/main/pending')

test('kept until delivered; steers go when their turn ends; a new thread learns its session; take empties it', () => {
  const base = { cwd: 'C:/repo', title: 'T', sessionId: null }
  p.addPending({ ...base, key: 'q1', tabId: 'a', text: 'queued one', mode: 'queue' })
  p.addPending({ ...base, tabId: 'a', text: 'steer one', mode: 'steer' })
  p.addPending({ ...base, key: 'q2', tabId: 'b', text: 'other thread', mode: 'queue' })
  p.pendingDelivered('q1')
  p.steersDelivered('b') // b has no steers: nothing goes
  p.pendingSession('a', 'sess-a')
  const left = p.takePending()
  assert.deepEqual(left.map((x) => [x.tabId, x.text, x.sessionId]), [['a', 'steer one', 'sess-a'], ['b', 'other thread', null]])
  assert.deepEqual(p.takePending(), [])
  // a thread closed on purpose drops its unsent messages
  p.addPending({ ...base, tabId: 'c', text: 'x', mode: 'queue' })
  p.threadClosed('c')
  assert.deepEqual(p.takePending(), [])
})

test('pictures are kept as files, named in the resent text, and removed once delivered', () => {
  const base = { cwd: 'C:/repo', title: 'T', sessionId: null, tabId: 'p', mode: 'queue' as const }
  p.addPending({ ...base, key: 'k1', text: 'look', pictures: [{ mediaType: 'image/png', data: Buffer.from('png!').toString('base64') }] })
  p.addPending({ ...base, key: 'k2', text: '', pictures: [{ mediaType: 'image/jpeg', data: Buffer.from('jpg!').toString('base64') }] })
  const first = p.takePending()[0].images![0]
  p.addPending({ ...base, key: 'k1', text: 'look', pictures: [{ mediaType: 'image/png', data: Buffer.from('png!').toString('base64') }] })
  p.addPending({ ...base, key: 'k2', text: '', pictures: [{ mediaType: 'image/jpeg', data: Buffer.from('jpg!').toString('base64') }] })
  p.pendingDelivered('k1')
  assert.ok(!existsSync(first)) // delivered: its picture file is gone
  const [left] = p.takePending()
  const pic = left.images![0]
  assert.ok(pic.endsWith('k2-0.jpg') && readFileSync(pic, 'utf8') === 'jpg!')
  assert.equal(p.resendText(left), `(Attached images, saved when Hive closed: ${pic})`)
})
