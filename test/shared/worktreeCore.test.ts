import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as w from '../../src/shared/worktreeCore'
// ---------- worktree naming ----------
test('slugify lowercases, dashes, trims and cuts', () => {
  assert.equal(w.slugify('Fix the Login page!'), 'fix-the-login-page')
  assert.equal(w.slugify('  --A__b  '), 'a-b')
  assert.equal(w.slugify('x'.repeat(30) + ' yyyy', 32), 'x'.repeat(30) + '-y')
  assert.equal(w.slugify('abc def', 4), 'abc')
})
test('parseTicket reads the key and the slug in its usual shapes', () => {
  assert.deepEqual(w.parseTicket('PROJ-123'), { key: 'PROJ-123', slug: '' })
  assert.deepEqual(w.parseTicket('proj-123 Fix login redirect'), { key: 'PROJ-123', slug: 'fix-login-redirect' })
  assert.deepEqual(w.parseTicket('APP-7: Null address crash'), { key: 'APP-7', slug: 'null-address-crash' })
  assert.deepEqual(w.parseTicket('APP-7 - x'), { key: 'APP-7', slug: 'x' })
  assert.equal(w.parseTicket('fix login'), null)
  assert.equal(w.parseTicket('PROJ-12x'), null)
  assert.equal(w.parseTicket('-12'), null)
})
test('ticketBranch is feat/KEY-slug, or feat/KEY without words', () => {
  assert.equal(w.ticketBranch({ key: 'PROJ-123', slug: 'fix-login' }), 'feat/PROJ-123-fix-login')
  assert.equal(w.ticketBranch({ key: 'PROJ-123', slug: '' }), 'feat/PROJ-123')
})
test('findTicketBranch finds an existing branch for the key, feat/ first, never a longer key', () => {
  assert.equal(w.findTicketBranch('PROJ-12', ['main', 'fix/PROJ-12-a', 'feat/PROJ-12-b']), 'feat/PROJ-12-b')
  assert.equal(w.findTicketBranch('PROJ-12', ['PROJ-12']), 'PROJ-12')
  assert.equal(w.findTicketBranch('PROJ-12', ['feat/PROJ-123-x', 'feat/XPROJ-12']), null)
  assert.equal(w.findTicketBranch('PROJ-12', ['feat/proj-12-lower']), 'feat/proj-12-lower')
})

// ---------- worktree plan ----------
const MAIN = 'C:\\r\\app'
const WTS = [{ path: 'C:/r/app', branch: 'main', head: 'a' }, { path: 'C:/r/.hive-worktrees/app/feat__PROJ-1-x', branch: 'feat/PROJ-1-x', head: 'b' }]
const plan = (o: Partial<Parameters<typeof w.planWorktree>[0]>) => w.planWorktree({ mainDir: MAIN, worktrees: WTS, localBranches: ['main', 'feat/PROJ-1-x', 'dev'], ...o })
test('planWorktree: branch or ticket, exactly one', () => {
  assert.equal(plan({}).ok, false)
  assert.equal(plan({ branch: 'a', ticket: 'PROJ-1' }).ok, false)
  assert.equal(plan({ branch: ' ', ticket: '' }).ok, false)
})
test('planWorktree reuses a worktree that has the branch, including via the ticket', () => {
  assert.deepEqual(plan({ branch: 'feat/PROJ-1-x' }), { ok: true, branch: 'feat/PROJ-1-x', act: 'reuse', path: WTS[1].path })
  assert.deepEqual(plan({ ticket: 'PROJ-1 other words' }), { ok: true, branch: 'feat/PROJ-1-x', act: 'reuse', path: WTS[1].path })
})
test('planWorktree adds a worktree for an existing branch, or creates a new branch', () => {
  assert.deepEqual(plan({ branch: 'dev' }), { ok: true, branch: 'dev', act: 'add', create: false })
  assert.deepEqual(plan({ ticket: 'PROJ-9 New thing' }), { ok: true, branch: 'feat/PROJ-9-new-thing', act: 'add', create: true })
})
const errorOf = (p: w.WorktreePlan) => (p.ok ? '' : p.error)
test('planWorktree refuses the main checkout branch, bad names and non-tickets', () => {
  assert.match(errorOf(plan({ branch: 'main' })), /main checkout/)
  assert.match(errorOf(plan({ branch: 'a..b' })), /valid branch/)
  assert.match(errorOf(plan({ ticket: 'no key here' })), /ticket key/)
})
test('validRepoName stays under the repos root', () => {
  assert.equal(w.validRepoName('my-api'), true)
  assert.equal(w.validRepoName('agents/Some Bot'), true)
  for (const bad of ['', ' ', '..', '../x', 'a/../b', 'C:\\x', '/etc', '\\\\srv\\share', 'a//b', './a']) assert.equal(w.validRepoName(bad), false, bad)
})

// ---------- cleanup ----------
test('hasWork ignores only Hive\'s own copies (root .env files, node_modules link)', () => {
  assert.equal(w.hasWork(''), false)
  assert.equal(w.hasWork('?? .env\n?? .env.local\r\n?? node_modules\n?? node_modules/\n'), false)
  assert.equal(w.hasWork(' M src/a.ts\n'), true)
  assert.equal(w.hasWork('?? notes.md\n'), true)
  assert.equal(w.hasWork('?? sub/.env\n'), true)
  assert.equal(w.hasWork(' M .env\n'), true) // a tracked .env change is real work
})
test('envCopies lists only untracked root .env files', () => {
  assert.deepEqual(w.envCopies('?? .env\n?? .env.local\n?? node_modules\n M .env.test\n?? sub/.env\n?? a.txt\n'), ['.env', '.env.local'])
  assert.deepEqual(w.envCopies(''), [])
})
test('decideCleanup: main never, gone is fine, running service refuses, dirty commits first', () => {
  const base = { exists: true, isMain: false, registered: true, dirty: false, running: [] }
  assert.equal(w.decideCleanup({ ...base, isMain: true }).act, 'refuse')
  assert.equal(w.decideCleanup({ ...base, exists: false, registered: false }).act, 'gone')
  assert.equal(w.decideCleanup({ ...base, registered: false }).act, 'refuse')
  const busy = w.decideCleanup({ ...base, dirty: true, running: ['my-api'] })
  assert.equal(busy.act, 'refuse'); assert.match(busy.note, /stop the service first/); assert.match(busy.note, /my-api/); assert.equal(busy.commit, false)
  assert.deepEqual(w.decideCleanup({ ...base, dirty: true }), { act: 'remove', commit: true, note: '' })
  assert.deepEqual(w.decideCleanup(base), { act: 'remove', commit: false, note: '' })
  assert.equal(w.WIP_MESSAGE, 'WIP: auto-saved when thread closed')
})
test('links: add dedupes by path (any slash or case), drop forgets and removes empty threads', () => {
  const l1 = { repo: 'a', path: 'C:\\w\\a\\x', branch: 'x', at: 1 }
  const l2 = { repo: 'b', path: 'C:\\w\\b\\y', branch: 'y', at: 2 }
  let map = w.addLink({}, 't1', l1)
  map = w.addLink(map, 't1', { ...l1, path: 'c:/w/a/x', at: 5 })
  assert.equal(map.t1.length, 1); assert.equal(map.t1[0].at, 5)
  map = w.addLink(map, 't1', l2)
  assert.equal(map.t1.length, 2)
  map = w.dropLinks(map, 't1', ['C:/w/a/x'])
  assert.deepEqual(map.t1.map((l) => l.repo), ['b'])
  map = w.dropLinks(map, 't1', [l2.path])
  assert.deepEqual(map, {})
  assert.deepEqual(w.dropLinks({ t2: [l1] }, 'none', ['x']), { t2: [l1] })
})

