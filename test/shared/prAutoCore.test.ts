// Auto-fix and Auto-archive: when a thread's PR makes Orbit send the fix prompt, or archive the thread
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { autoArchiveNow, autoFixNow, fixChecksPrompt, fixReviewPrompt, type AutoFixIn } from '../../src/shared/prAutoCore'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const x = (o: Partial<AutoFixIn> = {}): AutoFixIn => ({ on: 100, busy: false, state: 'OPEN', checks: 'failing', head: A, failing: ['test'], feedback: [], sentSha: undefined, sentAt: undefined, ...o })

test('fixChecksPrompt names the failing checks, the logs to read and the same PR', () => {
  const p = fixChecksPrompt(12, ['test', 'lint'])
  for (const s of ['#12', '`test`, `lint`', 'gh run view', '--log-failed', 'gh pr checks 12', 'Do not open another']) assert.ok(p.includes(s), s)
  assert.ok(fixChecksPrompt(3, []).includes('some checks'))
  assert.ok(fixReviewPrompt(4, ['robin', 'robin', 'sam']).includes('from robin, sam'))
})

test('autoFixNow sends the checks prompt once per head sha, only when on, idle and open', () => {
  const first = autoFixNow(x(), 12)
  assert.equal(first?.kind, 'checks')
  assert.equal(first?.kind === 'checks' && first.sha, A)
  assert.equal(autoFixNow(x({ sentSha: A }), 12), null) // the same head: never again
  assert.equal(autoFixNow(x({ sentSha: A.toUpperCase() }), 12), null)
  assert.equal(autoFixNow(x({ sentSha: A, head: B }), 12)?.kind, 'checks') // a new push that fails again
  assert.equal(autoFixNow(x({ on: undefined }), 12), null)
  assert.equal(autoFixNow(x({ busy: true }), 12), null)
  assert.equal(autoFixNow(x({ state: 'MERGED' }), 12), null)
  assert.equal(autoFixNow(x({ state: 'CLOSED' }), 12), null)
  assert.equal(autoFixNow(x({ checks: 'pending' }), 12), null)
  assert.equal(autoFixNow(x({ checks: 'passing' }), 12), null)
  assert.equal(autoFixNow(x({ head: '' }), 12), null)
})

test('autoFixNow sends review comments newer than the switch-on and the last sent, once', () => {
  const quiet = { checks: 'passing' }
  assert.equal(autoFixNow(x({ ...quiet, feedback: [{ author: 'robin', at: 50 }] }), 12), null) // before Auto-fix was on
  const r = autoFixNow(x({ ...quiet, feedback: [{ author: 'robin', at: 50 }, { author: 'sam', at: 150 }, { author: 'robin', at: 200 }] }), 12)
  assert.equal(r?.kind, 'review')
  assert.equal(r?.kind === 'review' && r.at, 200)
  assert.ok(r?.text.includes('from dan, kyle'))
  assert.equal(autoFixNow(x({ ...quiet, feedback: [{ author: 'sam', at: 150 }], sentAt: 150 }), 12), null)
  // failing checks on a new head go first
  assert.equal(autoFixNow(x({ feedback: [{ author: 'sam', at: 150 }] }), 12)?.kind, 'checks')
})

test('autoArchiveNow: on, merged or closed, idle and not archived yet', () => {
  const y = { on: true, busy: false, archived: false, state: 'MERGED' }
  assert.ok(autoArchiveNow(y))
  assert.ok(autoArchiveNow({ ...y, state: 'CLOSED' }))
  assert.ok(!autoArchiveNow({ ...y, state: 'OPEN' }))
  assert.ok(!autoArchiveNow({ ...y, on: false }))
  assert.ok(!autoArchiveNow({ ...y, busy: true }))
  assert.ok(!autoArchiveNow({ ...y, archived: true }))
})
