// Watchers: registry, legacy Watch migration, per-watcher scheduling with one persistent thread. Real files in a temp
// folder; the thread starter and thread state are fakes (the SDK is exercised separately).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  createWatcher, deleteWatcher, initWatchers, listWatchersView, migrateLegacyWatch, runWatcherNow, setWatcherEnabled, tick,
  updateWatcher, watcherDetail, watcherIds,
} from '../../src/main/watchers'
import { normalizeSchedule, watcherHeader, watcherId, foldersOf, defaultPrompt, legacyWatcher } from '../../src/shared/watchersCore'

type Call = { tabId: string; cwd: string; title: string; prompt: string; resume?: string }
let calls: Call[] = []
let threads = new Map<string, { working: boolean; sessionId: string | null; waitingReason?: string; lastOk?: boolean | null }>()
let closed: string[] = []
let pct: number | null = 30
let root = ''
let deps: Parameters<typeof initWatchers>[2]

function setup(env: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'hive-watchers-'))
  root = join(base, 'watchers')
  process.env.HIVE_WATCHERS_DIR = root
  calls = []; threads = new Map(); closed = []; pct = 30
  initWatchers(env, base, deps = {
    runThread: (t) => { calls.push(t); threads.set(t.tabId, { working: true, sessionId: threads.get(t.tabId)?.sessionId ?? t.resume ?? `sess-${calls.length}` }); return true },
    threadState: (id) => threads.get(id) ?? null,
    closeThread: (id) => { closed.push(id); threads.delete(id) },
    transcript: (cwd, sid) => `${cwd}/${sid}.jsonl`,
    usage: async () => ({ pct, readAt: Date.now(), error: pct === null ? 'down' : '' }),
  })
  return base
}
const finish = (tabId: string, ok = true) => { const t = threads.get(tabId)!; t.working = false; t.lastOk = ok }
const state = (id: string) => JSON.parse(readFileSync(join(root, id, 'state.json'), 'utf8'))
const wfile = (id: string) => JSON.parse(readFileSync(join(root, id, 'watcher.json'), 'utf8'))


test('ids, schedules, header and default prompt (pure)', () => {
  assert.equal(watcherId('Deploy Health!', []), 'deploy-health')
  assert.equal(watcherId('Watch', ['watch', 'watch-2']), 'watch-3')
  assert.equal(watcherId('_x', []), 'x')
  assert.equal(watcherId('***', []), 'watcher')
  assert.deepEqual(normalizeSchedule('1h').schedule, { every: '1h', daily: null, weekly: null })
  assert.equal(normalizeSchedule({}).schedule.every, 'adaptive')
  assert.deepEqual(normalizeSchedule({ every: 'soon', daily: '25:00', weekly: 'Funday 8' }).problems.length, 3)
  const f = foldersOf('demo', 'C:/w/demo')
  const h = watcherHeader({ name: 'Demo', kind: 'sweep', now: new Date(), lastRun: null, s: { last: { sweep: null, daily: null, weekly: null } }, f, promptFile: 'C:/w/demo/prompt.md', prompt: 'GOAL TEXT', fresh: true })
  assert.match(h, /SQLite database: C:\/w\/demo\/memory\/demo\.db/)
  assert.match(h, /new thread/)
  assert.ok(h.endsWith('GOAL TEXT'))
  const h2 = watcherHeader({ name: 'Demo', kind: 'daily', now: new Date(), lastRun: null, s: { last: { sweep: null, daily: null, weekly: null } }, f, promptFile: 'p.md', prompt: null, fresh: false })
  assert.match(h2, /unchanged since you last got them/)
  assert.ok(!h2.includes('GOAL TEXT'))
  const p = defaultPrompt('Demo', 'note the time')
  assert.match(p, /## Goal\n\nnote the time/)
  assert.match(p, /SQLite database/)
  // legacy prompt path inside the folder becomes relative
  assert.equal(legacyWatcher({ HIVE_WATCH_PROMPT: 'C:\\w\\watch\\p\\x.md' }, 'C:\\w\\watch', true, new Date()).prompt, 'p\\x.md')
  assert.equal(legacyWatcher({}, 'C:/w/watch', true, new Date()).prompt, 'watch.md')
})

test('migration moves the Watch folder whole, db intact, state carried over, runs once', () => {
  const home = mkdtempSync(join(tmpdir(), 'hive-home-'))
  const legacy = join(home, '.claude', 'hive', 'watch')
  mkdirSync(join(legacy, 'memory'), { recursive: true })
  mkdirSync(join(legacy, 'reports'), { recursive: true })
  writeFileSync(join(legacy, 'watch.md'), 'the watch prompt')
  writeFileSync(join(legacy, 'reports', 'daily.md'), '# r')
  writeFileSync(join(legacy, 'findings.jsonl'), '{"title":"a","at":"2026-10-31T00:00:00Z"}\n')
  const db = new DatabaseSync(join(legacy, 'memory', 'watch.db'))
  db.exec('create table t (x int)'); for (let i = 0; i < 37; i++) db.exec(`insert into t values (${i})`); db.close()
  writeFileSync(join(home, '.claude', 'hive', 'watch.json'), JSON.stringify({ enabled: false, since: 5, last: { sweep: 7, daily: 6, weekly: null }, runs: [{ id: 'watch-sweep-7', kind: 'sweep', startedAt: 7, endedAt: 8, sessionId: 's7' }] }))
  const r = join(home, 'watchers')
  const env = { HIVE_WATCH_DIR: '~/.claude/hive/watch', HIVE_WATCH_EVERY: 'off', HIVE_WATCH_DAILY: '08:00', HIVE_WATCH_WEEKLY: 'Mon 08:00' }
  assert.deepEqual(migrateLegacyWatch(env, home, r), [])
  assert.ok(!existsSync(legacy))
  const d = new DatabaseSync(join(r, 'watch', 'memory', 'watch.db'))
  assert.equal((d.prepare('select count(*) n from t').get() as { n: number }).n, 37)
  d.close()
  assert.equal(readFileSync(join(r, 'watch', 'watch.md'), 'utf8'), 'the watch prompt')
  assert.ok(existsSync(join(r, 'watch', 'reports', 'daily.md')))
  const w = JSON.parse(readFileSync(join(r, 'watch', 'watcher.json'), 'utf8'))
  assert.equal(w.name, 'Watch'); assert.equal(w.enabled, false); assert.equal(w.prompt, 'watch.md')
  assert.deepEqual(w.schedule, { every: 'off', daily: '08:00', weekly: 'Mon 08:00' })
  const s = JSON.parse(readFileSync(join(r, 'watch', 'state.json'), 'utf8'))
  assert.deepEqual(s.last, { sweep: 7, daily: 6, weekly: null }); assert.equal(s.since, 5)
  assert.equal(s.runs[0].tabId, 'watch-sweep-7'); assert.equal(s.sessionId, null)
  assert.ok(existsSync(join(home, '.claude', 'hive', 'watch.json.migrated')))
  // second start: nothing to do
  assert.deepEqual(migrateLegacyWatch(env, home, r), [])
  // a link at the old path (left for an older build) is never moved
  const home2 = mkdtempSync(join(tmpdir(), 'hive-home-'))
  mkdirSync(join(home2, '.claude', 'hive'), { recursive: true })
  symlinkSync(join(r, 'watch'), join(home2, '.claude', 'hive', 'watch'), 'junction')
  assert.deepEqual(migrateLegacyWatch(env, home2, join(home2, 'watchers')), [])
  assert.ok(!existsSync(join(home2, 'watchers')))
})

test('create writes the folder, starts ONE thread; later runs are turns in it; no overlap', async () => {
  setup()
  const r = createWatcher({ name: 'Tiny', goal: 'note the time', schedule: { every: '1h' } }, 'test')
  assert.equal(r.id, 'tiny'); assert.equal(r.message, '')
  for (const f of ['watcher.json', 'prompt.md', 'state.json', 'findings.jsonl', 'memory', 'reports']) assert.ok(existsSync(join(root, 'tiny', f)), f)
  assert.equal(calls.length, 1)
  const tab = calls[0].tabId
  assert.match(calls[0].prompt, /note the time/) // fresh thread: full prompt
  assert.equal(calls[0].resume, undefined)
  // still working: neither run-now nor the tick starts another
  assert.match(runWatcherNow('tiny'), /still working/)
  await tick(); assert.equal(calls.length, 1)
  finish(tab)
  await tick() // not due yet (1h)
  assert.equal(calls.length, 1)
  assert.ok(state('tiny').runs[0].endedAt)
  assert.equal(state('tiny').sessionId, 'sess-1')
  // run now: a new turn in the same live thread, prompt not repeated
  assert.equal(runWatcherNow('tiny', 'daily'), '')
  assert.equal(calls.length, 2); assert.equal(calls[1].tabId, tab)
  assert.match(calls[1].prompt, /unchanged since you last got them/)
  finish(tab)
  // the prompt changed: the next turn carries it
  updateWatcher('tiny', { prompt: 'NEW PROMPT' })
  assert.equal(runWatcherNow('tiny'), '')
  assert.match(calls[2].prompt, /NEW PROMPT/); assert.equal(calls[2].tabId, tab)
  finish(tab)
  // the thread's process went away (reload, tab closed): the next run resumes the same session, same tab
  threads.delete(tab)
  assert.equal(runWatcherNow('tiny'), '')
  assert.equal(calls[3].resume, 'sess-1'); assert.equal(calls[3].tabId, tab)
  finish(tab, false)
  await tick()
  assert.equal(state('tiny').runs.at(-1).error, 'The turn ended with an error')
  assert.equal((await listWatchersView()).watchers.find((w) => w.id === 'tiny')!.status, 'failed')
})

test('disable ends the session; enable starts a fresh thread', async () => {
  setup()
  createWatcher({ name: 'Tiny', goal: 'g', schedule: '1h' }, 'test')
  const tab = calls[0].tabId
  finish(tab); await tick()
  assert.equal(setWatcherEnabled('tiny', false), '')
  assert.deepEqual(closed, [tab])
  assert.equal(wfile('tiny').enabled, false)
  assert.equal(state('tiny').sessionId, null); assert.equal(state('tiny').tabId, null)
  assert.match(runWatcherNow('tiny'), /^$/) // run now still works by hand when off
  assert.notEqual(calls[1].tabId, tab); assert.equal(calls[1].resume, undefined); assert.match(calls[1].prompt, /new thread/)
  finish(calls[1].tabId)
  setWatcherEnabled('tiny', true)
  await new Promise((r) => setTimeout(r, 700)) // enable ticks shortly after
  await tick()
  assert.equal(wfile('tiny').enabled, true)
  assert.equal(state('tiny').sessionId, null) // fresh: the old session is gone
  const off = (await listWatchersView()).watchers.find((w) => w.id === 'tiny')!
  assert.equal(off.enabled, true)
})

test('per-watcher adaptive schedules and fixed ones are independent', async () => {
  setup()
  createWatcher({ name: 'Fast', goal: 'g', schedule: { every: 'adaptive', tiers: '50:1h,100:1d' } }, 't')
  createWatcher({ name: 'Slow', goal: 'g', schedule: { every: 'adaptive', tiers: '10:1h,100:2d' } }, 't')
  createWatcher({ name: 'Fixed', goal: 'g', schedule: '30m' }, 't')
  for (const c of calls) finish(c.tabId)
  await tick()
  pct = 30
  const l = await listWatchersView()
  const by = Object.fromEntries(l.watchers.map((w) => [w.id, w]))
  assert.equal(by.fast.tier!.everyMs, 3_600_000); assert.equal(by.fast.tier!.index, 0)
  assert.equal(by.slow.tier!.everyMs, 2 * 86_400_000); assert.equal(by.slow.tier!.index, 1)
  assert.equal(by.fixed.tier, null)
  // pretend each last sweep was 2h ago: fast (1h) and fixed (30m) are due, slow (2d) is not
  for (const id of ['fast', 'slow', 'fixed']) {
    const s = state(id); s.last.sweep = Date.now() - 2 * 3_600_000
    writeFileSync(join(root, id, 'state.json'), JSON.stringify(s))
  }
  const before = calls.length
  await tick()
  const ran = calls.slice(before).map((c) => c.title).sort()
  assert.deepEqual(ran, ['Watcher: Fast', 'Watcher: Fixed'])
  // usage unreadable: the slowest tier
  pct = null
  const l2 = await listWatchersView()
  assert.equal(l2.watchers.find((w) => w.id === 'fast')!.tier!.everyMs, 86_400_000)
})

test('report-only watcher starts on its report slot (since set on first tick)', async () => {
  setup()
  createWatcher({ name: 'Rep', goal: 'g', schedule: { every: 'off', daily: '00:00' }, enabled: false }, 't')
  assert.equal(calls.length, 0)
  updateWatcher('rep', { enabled: true })
  await new Promise((r) => setTimeout(r, 700))
  await tick()
  assert.equal(calls.length, 0) // the slot already passed before it was on: not "missed"
  const s = state('rep'); assert.ok(s.since)
  s.since = Date.now() - 2 * 86_400_000; writeFileSync(join(root, 'rep', 'state.json'), JSON.stringify(s))
  await tick()
  assert.equal(calls.length, 1); assert.match(calls[0].prompt, /Run kind: daily/)
})

test('detail, list, soft delete', async () => {
  setup()
  createWatcher({ name: 'Tiny', goal: 'g', schedule: '1h' }, 'test')
  writeFileSync(join(root, 'tiny', 'findings.jsonl'), '{"title":"f1"}\n{"title":"f2"}\n')
  writeFileSync(join(root, 'tiny', 'reports', 'r.md'), '# r')
  const d = (await watcherDetail('tiny'))!
  assert.equal(d.findingsList.length, 2); assert.equal(d.reports.length, 1); assert.equal(d.runs.length, 1)
  assert.equal(d.findings, 2)
  assert.equal(await watcherDetail('../etc'), null)
  const to = deleteWatcher('tiny')
  assert.ok(to.includes('_deleted')); assert.ok(existsSync(join(to, 'prompt.md')))
  assert.deepEqual(watcherIds(), [])
  assert.ok(closed.length === 1)
  assert.ok(readdirSync(root).includes('_deleted'))
})

test('self-scheduled watcher wakes only for its own due rows, with just the wake reason, and after 6 h with none', async () => {
  setup()
  createWatcher({ name: 'Selfie', goal: 'plans itself', schedule: { every: 'self' } }, 't')
  assert.equal(wfile('selfie').schedule.every, 'self')
  assert.equal(calls.length, 1) // created on: the first run starts a fresh thread with the full header
  const tab = calls[0].tabId
  finish(tab)
  const db = new DatabaseSync(join(root, 'selfie', 'schedule.db'))
  db.exec(`CREATE TABLE IF NOT EXISTS wakeups (id INTEGER PRIMARY KEY, wake_at TEXT NOT NULL, purpose TEXT, status TEXT NOT NULL DEFAULT 'pending', woken_at TEXT, finished_at TEXT, result TEXT, created_at TEXT)`)
  const iso = (ms: number) => new Date(ms).toISOString()
  db.prepare('INSERT INTO wakeups (wake_at, purpose) VALUES (?, ?)').run(iso(Date.now() + 3_600_000), 'later')
  await tick(); assert.equal(calls.length, 1) // nothing due, one pending: no fallback either
  db.prepare('INSERT INTO wakeups (wake_at, purpose) VALUES (?, ?)').run(iso(Date.now() - 60_000), 'check n8n')
  await tick()
  assert.equal(calls.length, 2); assert.equal(calls[1].tabId, tab)
  assert.match(calls[1].prompt, /You scheduled this in .*schedule\.db: #2 at .* \(check n8n\)/)
  assert.doesNotMatch(calls[1].prompt, /Memory folder|Findings file|organize_thread/) // no instructions
  assert.deepEqual(db.prepare('SELECT id, status FROM wakeups ORDER BY id').all().map((r) => ({ ...r })), [{ id: 1, status: 'pending' }, { id: 2, status: 'woken' }])
  finish(tab)
  await tick(); assert.equal(calls.length, 2) // woken rows are the watcher's to finish, never woken twice
  // nothing pending and the last run 6 h ago: the fallback wake
  db.exec(`UPDATE wakeups SET status = 'done'`)
  const s = state('selfie'); s.runs.at(-1).startedAt = Date.now() - 7 * 3_600_000; writeFileSync(join(root, 'selfie', 'state.json'), JSON.stringify(s))
  await tick()
  assert.equal(calls.length, 3); assert.match(calls[2].prompt, /Nothing was pending .* after 6 hours/)
  finish(tab)
  // Hive restarts: the first tick always wakes it once to catch up, saying when Hive was last running; then only due rows
  writeFileSync(join(root, '.heartbeat'), String(new Date('2026-11-01T09:00:00').getTime()))
  initWatchers({}, join(root, '..'), deps)
  await tick()
  assert.equal(calls.length, 4)
  assert.match(calls[3].prompt, /just started; it was last running at 2026-11-01T09:00:00.*Catch up on anything you missed/s)
  assert.doesNotMatch(calls[3].prompt, /Nothing was pending/)
  finish(tab)
  await tick(); assert.equal(calls.length, 4)
  db.close()
})

test('a watcher thread grown past the limit gets a fresh thread at its next run; a small one carries on', async () => {
  const base = setup()
  createWatcher({ name: 'Big', goal: 'watch things', schedule: { every: '1h' } }, 'test')
  const tab = calls[0].tabId
  finish(tab)
  const file = join(base, 'big-session.jsonl')
  const usage = (n: number) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: n } } })
  deps.transcript = () => file
  writeFileSync(file, `${usage(40_000)}\n`)
  assert.equal(runWatcherNow('big'), '')
  assert.equal(calls[1].tabId, tab) // small: same thread
  finish(tab)
  writeFileSync(file, `${usage(40_000)}\n${usage(400_000)}\n`)
  assert.equal(runWatcherNow('big'), '')
  assert.deepEqual(closed, [tab]) // the big thread is closed...
  assert.notEqual(calls[2].tabId, tab) // ...and the run starts a new one
  assert.equal(calls[2].resume, undefined)
  assert.match(calls[2].prompt, /watch things/) // with the full prompt, as a fresh thread
})

test('a self-scheduled watcher rotated at a wake still gets the due rows in its fresh thread', async () => {
  const base = setup()
  createWatcher({ name: 'Selfbig', goal: 'plans itself', schedule: { every: 'self' } }, 't')
  const tab = calls[0].tabId
  finish(tab)
  const file = join(base, 'selfbig-session.jsonl')
  deps.transcript = () => file
  writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 400_000 } } })}\n`)
  const db = new DatabaseSync(join(root, 'selfbig', 'schedule.db'))
  db.exec(`CREATE TABLE IF NOT EXISTS wakeups (id INTEGER PRIMARY KEY, wake_at TEXT NOT NULL, purpose TEXT, status TEXT NOT NULL DEFAULT 'pending', woken_at TEXT, finished_at TEXT, result TEXT, created_at TEXT)`)
  db.prepare('INSERT INTO wakeups (wake_at, purpose) VALUES (?, ?)').run(new Date(Date.now() - 60_000).toISOString(), 'check n8n')
  await tick()
  assert.equal(calls.length, 2)
  assert.deepEqual(closed, [tab]); assert.notEqual(calls[1].tabId, tab)
  assert.match(calls[1].prompt, /plans itself/) // the full header and prompt, as a fresh thread...
  assert.match(calls[1].prompt, /You scheduled this in .*schedule\.db: #1 at .* \(check n8n\)/) // ...plus what woke it
  assert.equal(db.prepare('SELECT status FROM wakeups').get()!.status, 'woken')
  db.close()
})
