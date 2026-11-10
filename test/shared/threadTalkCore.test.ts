// Pure parts of thread talk: labelling, listing from a live map, wait / timeout, the queue's busy flag,
// the receiving tab's event handling and transcript reload.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatThreads, formatWait, fromLabel, labelFromThread, listThreads, parseFromThread, resolveThread, statusOf, waitIdle, type ThreadInfo } from '../../src/shared/threadTalkCore'
import { turnQueue } from '../../src/main/queueCore'
import { applyEvent, toolLine, type Session } from '../../src/renderer/src/chat'
import { loadHistory } from '../../src/main/history'


// ---- labelling ----
test('label puts the sender on the first line and round-trips', () => {
  const from = { id: 'new-171', title: 'Fix login' }
  const msg = labelFromThread(from, 'Run the tests\nthen report')
  assert.equal(msg, '[From thread "Fix login" (new-171)]\nRun the tests\nthen report')
  assert.deepEqual(parseFromThread(msg), { from, text: 'Run the tests\nthen report' })
})
test('label keeps quotes and parentheses in titles, flattens newlines', () => {
  const from = { id: 'thread-ab12cd34', title: 'Say "hi" (fast)\nnow' }
  assert.equal(fromLabel(from), '[From thread "Say "hi" (fast) now" (thread-ab12cd34)]')
  const p = parseFromThread(labelFromThread(from, 'x'))
  assert.deepEqual(p, { from: { id: 'thread-ab12cd34', title: 'Say "hi" (fast) now' }, text: 'x' })
})
test('plain text and a label not at the start are not thread messages', () => {
  assert.equal(parseFromThread('hello'), null)
  assert.equal(parseFromThread('see [From thread "a" (b)]\nx'), null)
})

// ---- listing ----
const info = (o: Partial<ThreadInfo>): ThreadInfo => ({ sessionId: null, title: 't', cwd: 'C:\\r', busy: false, background: false, ...o })
const map = new Map<string, ThreadInfo>([
  ['new-1', info({ title: 'Main', sessionId: 's-1' })],
  ['thread-2', info({ title: 'Worker', busy: true, background: true, sessionId: 's-2', waitingReason: 'old' })],
  ['new-3', info({ title: 'Asks', waitingReason: 'pick a db' })],
])
test('status: working wins over waiting, else idle', () => {
  assert.equal(statusOf({ busy: true, waitingReason: 'x' }), 'working')
  assert.equal(statusOf({ busy: false, waitingReason: 'x' }), 'waiting')
  assert.equal(statusOf({ busy: false }), 'idle')
})
test('listThreads maps the live map, marks self, keeps background flag', () => {
  const rows = listThreads(map, 'new-1')
  assert.deepEqual(rows.map((r) => [r.id, r.status, r.self, r.background]), [
    ['new-1', 'idle', true, false], ['thread-2', 'working', false, true], ['new-3', 'waiting', false, false],
  ])
  assert.equal(rows[2].reason, 'pick a db')
  assert.equal(rows[1].reason, undefined)
  const text = formatThreads(rows)
  assert.match(text, /"Main" id=new-1 \(this thread\)/)
  assert.match(text, /status: working; in the background/)
  assert.match(text, /status: waiting \(pick a db\); open as a tab/)
  assert.equal(formatThreads([]), 'No live threads.')
})
test('resolveThread by tab id or session id', () => {
  assert.equal(resolveThread('thread-2', map), 'thread-2')
  assert.equal(resolveThread('s-1', map), 'new-1')
  assert.equal(resolveThread('nope', map), undefined)
})

// ---- waiting ----
function watched(busy: boolean) {
  const cbs = new Set<() => void>()
  const w = { b: busy, busy: () => w.b, onIdle: (cb: () => void) => { cbs.add(cb); return () => cbs.delete(cb) }, idle: () => { w.b = false; for (const c of [...cbs]) c() }, cbs }
  return w
}
test('idle thread returns at once', async () => assert.equal(await waitIdle(watched(false), 1000), 'idle'))
test('timeout 0 is a non-blocking read', async () => {
  const w = watched(true)
  assert.equal(await waitIdle(w, 0), 'timeout')
  assert.equal(w.cbs.size, 0)
})
test('busy thread returns when it goes idle and unsubscribes', async () => {
  const w = watched(true)
  const p = waitIdle(w, 10_000)
  assert.equal(w.cbs.size, 1)
  setTimeout(() => w.idle(), 10)
  assert.equal(await p, 'idle')
  assert.equal(w.cbs.size, 0)
})
test('busy thread times out and unsubscribes', async () => {
  const w = watched(true)
  const t0 = Date.now()
  assert.equal(await waitIdle(w, 50), 'timeout')
  assert.ok(Date.now() - t0 >= 45)
  assert.equal(w.cbs.size, 0)
})
test('two threads waiting on each other both come back on timeout', async () => {
  // A's turn is busy while it waits on B, and B's while it waits on A
  const a = watched(true), b = watched(true)
  const [ra, rb] = await Promise.all([waitIdle(b, 40), waitIdle(a, 60)])
  assert.deepEqual([ra, rb], ['timeout', 'timeout'])
})
test('abort signal ends the wait (the user pressed Stop)', async () => {
  const w = watched(true)
  const ac = new AbortController()
  const p = waitIdle(w, 10_000, ac.signal)
  ac.abort()
  assert.equal(await p, 'timeout')
  assert.equal(w.cbs.size, 0)
})
test('formatWait texts', () => {
  assert.equal(formatWait({ title: 'W', id: 'x', status: 'idle', reply: 'done: 4', timedOut: false }), 'Thread "W" (x) is idle.\nIts last reply:\ndone: 4')
  assert.match(formatWait({ title: 'W', id: 'x', status: 'working', reply: null, timedOut: true }), /^Thread "W" \(x\) is still working\.\nNo reply from it yet\.$/)
  assert.match(formatWait({ title: 'W', id: 'x', status: 'closed', reply: 'r', timedOut: false }), /is not running/)
  assert.match(formatWait({ title: 'W', id: 'x', status: 'waiting', reply: 'which db?', timedOut: false }), /is waiting\.\nIts last reply:\nwhich db\?/)
})

// ---- queue busy flag (what wait_for_thread watches) ----
test('turnQueue.isBusy stays true while queued messages remain', () => {
  const got: string[] = []
  const q = turnQueue<string>((m) => got.push(m), () => {})
  assert.equal(q.isBusy(), false)
  q.submit('a', 'first')
  assert.equal(q.isBusy(), true)
  q.submit('b', 'second')
  q.turnEnded()
  assert.equal(q.isBusy(), true) // second went in
  q.turnEnded()
  assert.equal(q.isBusy(), false)
  assert.deepEqual(got, ['first', 'second'])
})

// ---- receiving tab ----
const blank = (): Session => ({ id: 'new-3', title: 'T', items: [], streaming: '', busy: false, loaded: true, background: false })
test('hive_thread_msg adds a thread item and marks busy; queue phases update it', () => {
  let s = applyEvent(blank(), { type: 'hive_thread_msg', fromId: 'new-1', fromTitle: 'Main', text: 'hi' })
  assert.equal(s.busy, true)
  assert.deepEqual(s.items[0], { kind: 'thread', fromId: 'new-1', fromTitle: 'Main', text: 'hi' })
  s = applyEvent(s, { type: 'hive_thread_msg', fromId: 'new-1', fromTitle: 'Main', text: 'later', queueId: 'q1' })
  assert.deepEqual((s.items[1] as any).queue, { id: 'q1', pending: true })
  s = applyEvent(s, { type: 'hive_queue', id: 'q1', phase: 'sent' })
  assert.deepEqual((s.items[1] as any).queue, { id: 'q1', pending: false })
  s = applyEvent(s, { type: 'hive_thread_msg', fromId: 'new-1', fromTitle: 'Main', text: 'gone', queueId: 'q2' })
  s = applyEvent(s, { type: 'hive_queue', id: 'q2', phase: 'removed' })
  assert.equal(s.items.length, 2)
  s = applyEvent(s, { type: 'hive_thread_msg', fromId: 'new-1', fromTitle: 'Main', text: 'now', steer: true })
  assert.equal((s.items[2] as any).steer, true)
  s = applyEvent(s, { type: 'hive_thread_msg', fromId: 'new-1', fromTitle: 'Main', text: 'dies', queueId: 'q3' })
  s = applyEvent(s, { type: 'hive_closed' })
  assert.equal(s.items.some((i: any) => i.text === 'dies'), false)
})
test('tool lines on the sending side', () => {
  assert.deepEqual(toolLine('mcp__hive__start_thread', { title: 'Count files' }), { verb: 'Started thread', what: 'Count files' })
  assert.deepEqual(toolLine('mcp__hive__message_thread', { thread: 'x', text: 'go' }), { verb: 'Messaged thread', what: 'x: go' })
  assert.equal(toolLine('mcp__hive__wait_for_thread', { thread: 'x', timeout_s: 0 }).verb, 'Checked thread')
  assert.equal(toolLine('mcp__hive__wait_for_thread', { thread: 'x' }).verb, 'Waited for thread')
})

// ---- transcript reload ----
test('a reloaded transcript shows thread messages as thread items', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-'))
  const p = join(dir, 's.jsonl')
  const label = labelFromThread({ id: 'new-1', title: 'Main' }, 'count the files')
  writeFileSync(p, [
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: label }] } },
    { type: 'user', message: { role: 'user', content: 'plain string message' } },
    { type: 'user', message: { role: 'user', content: labelFromThread({ id: 'new-1', title: 'Main' }, 'as string') } },
  ].map((e) => JSON.stringify(e)).join('\n'))
  const items = await loadHistory(p)
  assert.deepEqual(items, [
    { kind: 'thread', fromId: 'new-1', fromTitle: 'Main', text: 'count the files' },
    { kind: 'user', text: 'plain string message', images: [] },
    { kind: 'thread', fromId: 'new-1', fromTitle: 'Main', text: 'as string' },
  ])
})

