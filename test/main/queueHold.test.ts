// the turn queue under a paused team's hold, taking what is left when a process ends, and one tab's sends in order
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { inOrder, turnQueue } from '../../src/main/queueCore'

test("held: the user's own messages still go in, team posts wait for the resume", () => {
  const got: string[] = []
  const ids: string[] = []
  const q = turnQueue<string>((m, _p, id) => { got.push(m); ids.push(id) }, () => {})
  q.markBusy()
  q.hold(true)
  q.submit('post', 'team post')
  q.submit('mine', 'my queued message', false, true)
  q.turnEnded() // the turn the pause interrupted
  assert.deepEqual(got, ['my queued message'])
  assert.deepEqual(ids, ['mine'])
  q.turnEnded()
  assert.deepEqual(got, ['my queued message']) // the post still waits
  q.submit('now', 'typed while idle and held', false, true)
  assert.deepEqual(got, ['my queued message', 'typed while idle and held'])
  q.turnEnded()
  q.hold(false)
  assert.deepEqual(got, ['my queued message', 'typed while idle and held', 'team post'])
})

test('held: an interrupt of the user goes in once the interrupted turn ends', () => {
  const got: string[] = []
  const q = turnQueue<string>((m) => got.push(m), () => {})
  q.markBusy()
  q.hold(true)
  q.submit('post', 'team post')
  q.submit('stop', 'stop and do this', true, true)
  q.turnEnded()
  assert.deepEqual(got, ['stop and do this'])
})

test('drain takes everything still waiting, in order', () => {
  const q = turnQueue<string>(() => {}, () => {})
  q.markBusy()
  q.submit('a', 'A')
  q.submit('b', 'B')
  assert.deepEqual(q.drain(), [{ id: 'a', msg: 'A' }, { id: 'b', msg: 'B' }])
  assert.equal(q.size(), 0)
})

test('a send that waits holds back the sends after it; with nothing ahead a send runs at once', async () => {
  const o = inOrder()
  const out: string[] = []
  o.run('t', () => out.push('plain first'))
  assert.deepEqual(out, ['plain first']) // synchronous
  let raise!: () => void
  const boost = new Promise<void>((r) => { raise = r })
  o.run('t', () => out.push('ultrathink'), boost)
  o.run('t', () => out.push('after it'))
  o.run('other', () => out.push('another tab'))
  assert.deepEqual(out, ['plain first', 'another tab'])
  raise()
  await boost
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(out, ['plain first', 'another tab', 'ultrathink', 'after it'])
  assert.equal(o.pending('t'), false)
  // a failed wait still lets the send go
  o.run('t', () => out.push('after a failed boost'), Promise.reject(new Error('no')))
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(out.at(-1), 'after a failed boost')
})

test('a send that fails after waiting is reported to the caller, not dropped', async () => {
  const o = inOrder()
  const errors: string[] = []
  o.run('t', () => { throw new Error('no process') }, Promise.resolve(), (e) => errors.push((e as Error).message))
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(errors, ['no process'])
  assert.throws(() => o.run('t', () => { throw new Error('at once') }), /at once/) // nothing ahead: it throws to the caller (chat:send rejects)
})
