// Watchers, main process: plain code. Every watcher is a folder under ~/.claude/hive/watchers/<id>/ and owns ONE
// long-lived background thread: scheduled runs go into that thread as new turns, so it keeps its conversation (the SDK
// compacts a long one by itself). Disabling ends the thread's session; enabling starts a fresh one at the next run.
// A run never starts while the watcher's thread is still working (its own run, or the user talking to it).
// Adaptive watchers take their sweep interval from the 7-day usage limit, each with its own tiers. Hive adds no guards:
// the thread runs in auto mode like any other background thread. With HIVE_TEST_MODE=1 nothing runs on its own.
// No Electron imports: the thread starter and the thread state are passed in.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dueKind, localIso, markStarted, nextRuns, parseFindings, pickTier, type RunKind, type WatchConfig } from '../shared/watchCore'
import { appName } from '../shared/appName'
import {
  defaultPrompt, earliest, emptyState, foldersOf, reportsRootOf, legacyState, legacyWatcher, MAX_RUNS, normalizeSchedule, normalizeState,
  normalizeWatcher, statusOf, textHash, wakeMessage, watcherConfig, watcherHeader, watcherId,
  type WatcherDetail, type WatcherFile, type WatcherInput, type WatcherState, type WatcherSummary, type WatchersList,
} from '../shared/watchersCore'
import { blocked, dataDir, TEST_MODE, testWeeklyPct } from './testMode'
import { writeFileSafe } from './safeWrite'
import { FALLBACK_MS, markWoken, readWakeups, scheduleFile, type Wakeup } from './selfSchedule'
import { lastContextTokens } from './sessionStats'


// starts the watcher's thread (resume = continue that Claude session) or, when its tab is live, adds a turn to it
export type RunThread = (t: { tabId: string; cwd: string; title: string; prompt: string; resume?: string }) => boolean // false: no window yet
export type ThreadState = (tabId: string) => { working: boolean; sessionId: string | null; waitingReason?: string; lastOk?: boolean | null } | null
export type Usage = () => Promise<{ pct: number | null; readAt: number; error: string }> // the 7-day limit, 0-100
// a watcher Hive has built in (Dependabot): shown in the same list with its own switch
export type Builtin = { id: string; summary: () => WatcherSummary | null; setEnabled: (on: boolean) => void }
type Deps = {
  runThread: RunThread; threadState: ThreadState; closeThread: (tabId: string) => void
  transcript: (cwd: string, sessionId: string) => string; usage: Usage; changed?: () => void
}

let deps: Deps = {
  runThread: () => false, threadState: () => null, closeThread: () => {}, transcript: () => '',
  usage: async () => ({ pct: null, readAt: Date.now(), error: 'no usage reader' }),
}
let workspace = ''
let builtins: Builtin[] = []
let migration: string[] = [] // what the legacy migration did or why it could not, shown in the list

// ~/.claude/hive/watchers (HIVE_WATCHERS_DIR, or HIVE_DATA_DIR/hive/watchers, for tests)
export const watchersRoot = () =>
  process.env.HIVE_WATCHERS_DIR || join(dataDir(), 'hive', 'watchers')
const dirOf = (id: string) => join(watchersRoot(), id)
const tabTitle = (w: WatcherFile) => `Watcher: ${w.name}`

function writeJson(file: string, v: unknown) {
  writeFileSafe(file, JSON.stringify(v, null, 2) + '\n')
}
const readJson = (file: string): unknown => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }

const validId = (id: string) => /^[a-z0-9][a-z0-9-]*$/i.test(id)
function readWatcher(id: string): WatcherFile | null {
  return validId(id) ? normalizeWatcher(readJson(join(dirOf(id), 'watcher.json'))) : null
}
const readState = (id: string): WatcherState => normalizeState(readJson(join(dirOf(id), 'state.json')))
const saveWatcher = (id: string, w: WatcherFile) => writeJson(join(dirOf(id), 'watcher.json'), w)
const saveState = (id: string, s: WatcherState) => writeJson(join(dirOf(id), 'state.json'), { ...s, runs: s.runs.slice(-MAX_RUNS) })

// every watcher folder (not _deleted or other _ / . folders), sorted by name
export function watcherIds(): string[] {
  let names: string[]
  try { names = readdirSync(watchersRoot()) } catch { return [] }
  return names.filter((n) => validId(n) && existsSync(join(watchersRoot(), n, 'watcher.json'))).sort()
}

// the tab a watcher's Claude session runs in ("watcher-..."), so resuming it from elsewhere (the phone, a resent
// message) keeps it read-only; null when the session is no watcher's
export function watcherTabFor(sessionId: string): string | null {
  for (const id of watcherIds()) {
    const st = readState(id)
    if (st.sessionId === sessionId) return st.tabId ?? `watcher-${id}-${Date.now()}`
  }
  return null
}

const cfgOf = (id: string, w: WatcherFile) => watcherConfig(dirOf(id), w)
const cwdOf = (w: WatcherFile) => w.cwd || workspace || homedir()

// Hive's own heartbeat (written every tick) tells a self-scheduled watcher, on its first wake after a start, how long
// Hive was closed; woke = the watchers that already had a run since this start
const heartbeatFile = () => join(watchersRoot(), '.heartbeat')
const readHeartbeat = (): number | null => { try { const t = Number(readFileSync(heartbeatFile(), 'utf8').trim()); return t > 0 ? t : null } catch { return null } }
const beat = () => { try { mkdirSync(watchersRoot(), { recursive: true }); writeFileSync(heartbeatFile(), String(Date.now())) } catch { /* next tick */ } }
let lastSeen: number | null = null
let woke = new Set<string>()

export function initWatchers(env: Record<string, string>, workspaceRoot: string, d: Deps, b: Builtin[] = []) {
  deps = d
  builtins = b
  workspace = workspaceRoot
  rotateTokens = rotateTokensOf(env.HIVE_WATCHER_ROTATE_CONTEXT)
  woke = new Set()
  lastSeen = readHeartbeat()
  if (TEST_MODE) return // never on its own in test mode, and the real Watch folder is never moved
  migration = migrateLegacyWatch(env)
  if (migration.length) console.warn(`Watchers: ${migration.join('; ')}`)
  setTimeout(() => void tick(), 60_000).unref() // after the window has loaded (a reload stops every live thread)
  setInterval(() => void tick(), 30_000).unref()
}

export function configureWatchers(workspaceRoot: string, env: Record<string, string> = {}) {
  workspace = workspaceRoot
  rotateTokens = rotateTokensOf(env.HIVE_WATCHER_ROTATE_CONTEXT)
  reportsRoot = TEST_MODE ? '' : reportsRootOf(env.HIVE_WATCHERS_REPORTS_DIR, workspaceRoot)
}
let reportsRoot = ''
const reportsDir = (id: string, w: WatcherFile) => foldersOf(id, dirOf(id), reportsRoot, w.name).reports

// ---- migration of the single Watch (HIVE_WATCH_DIR + ~/.claude/hive/watch.json) into watcher "watch" ----

// moves the folder as a whole (memory/, the agent's SQLite db, reports/, findings.jsonl, the prompt keep their names),
// then writes watcher.json from the HIVE_WATCH_* settings and state.json from watch.json. Runs once: nothing to do when
// the old folder is gone, is a link, or watchers/watch already exists. Returns notes only when something needs a look.
export function migrateLegacyWatch(env: Record<string, string>, home = homedir(), root = watchersRoot()): string[] {
  const raw = (env.HIVE_WATCH_DIR ?? '').trim()
  if (!raw) return [] // the old Watch was off without its folder setting: nothing to migrate
  const legacyDir = raw.replace(/^~(?=$|[\\/])/, home)
  const target = join(root, 'watch')
  let st
  try { st = lstatSync(legacyDir) } catch { return [] } // nothing to migrate
  if (st.isSymbolicLink() || !st.isDirectory() || existsSync(target)) return []
  const stateFile = join(home, '.claude', 'hive', 'watch.json') // the old scheduler state, always here
  const old = legacyState(readJson(stateFile))
  try {
    mkdirSync(root, { recursive: true })
    renameSync(legacyDir, target)
  } catch (e) {
    return [`Could not move the Watch folder ${legacyDir} to ${target}: ${(e as Error).message}. Close anything using it and restart ${appName()}.`]
  }
  writeJson(join(target, 'watcher.json'), legacyWatcher(env, legacyDir, old.enabled, new Date()))
  writeJson(join(target, 'state.json'), old.state)
  if (existsSync(stateFile)) { try { renameSync(stateFile, `${stateFile}.migrated`) } catch { /* kept; never read again */ } }
  return []
}

// ---- scheduling ----

type Plan = { c: WatchConfig; tier: WatcherSummary['tier'] }
async function plan(id: string, w: WatcherFile, u: Awaited<ReturnType<Usage>> | null): Promise<Plan> {
  const c = cfgOf(id, w)
  if (!c.tiers) return { c, tier: null }
  const p = pickTier(c.tiers, u?.pct ?? null)
  return { c: { ...c, everyMs: p.everyMs }, tier: { index: p.tier, everyMs: p.everyMs, pct: p.pct, tiers: c.tiers } }
}
// test mode never asks Claude for usage: HIVE_TEST_WEEKLY_PCT stands in for the 7-day limit (unset = unknown)
const readUsage = () => (TEST_MODE
  ? Promise.resolve(testWeeklyPct())
  : deps.usage().catch((e) => ({ pct: null, readAt: Date.now(), error: String((e as Error)?.message ?? e) })))

// the latest run, with its end recorded once the thread is idle or gone; running = the thread still works
function settle(id: string, s: WatcherState): { s: WatcherState; running: boolean } {
  const t = s.tabId ? deps.threadState(s.tabId) : null
  let dirty = false
  if (t?.sessionId && t.sessionId !== s.sessionId) { s.sessionId = t.sessionId; dirty = true }
  const cur = s.runs.at(-1)
  if (cur && !cur.endedAt && !cur.error) {
    if (t?.sessionId && !cur.sessionId) { cur.sessionId = t.sessionId; dirty = true }
    if (!t?.working) {
      cur.endedAt = Date.now()
      if (t && t.lastOk === false) cur.error = 'The turn ended with an error'
      dirty = true
    }
  }
  if (dirty) saveState(id, s)
  return { s, running: !!t?.working }
}

let ticking = false
export async function tick(): Promise<void> {
  if (ticking || TEST_MODE) return
  ticking = true
  try {
    beat()
    const ids = watcherIds()
    const ws = ids.map((id) => [id, readWatcher(id)] as const).filter((x): x is [string, WatcherFile] => !!x[1] && x[1].enabled)
    const u = ws.some(([, w]) => w.schedule.every === 'adaptive') ? await readUsage() : null
    let started = false
    for (const [id] of ws) {
      const cur = readWatcher(id) // re-read: a switch may have flipped while the usage was read
      if (!cur?.enabled) continue
      const { c } = await plan(id, cur, u)
      const { s, running } = settle(id, readState(id))
      // report slots count as missed only after the watcher was first seen on; without this a report-only watcher never starts
      if (s.since === null) { s.since = Date.now(); saveState(id, s) }
      if (cur.schedule.every === 'self') {
        const wake = running ? null : selfWake(c.dir, s, !woke.has(id))
        if (wake && !startRun(id, cur, c, s, 'sweep', wake)) started = true
        continue
      }
      const kind = dueKind(new Date(), c, { ...s, enabled: true }, running)
      if (kind && !startRun(id, cur, c, s, kind)) started = true
    }
    if (started) deps.changed?.()
  } finally {
    ticking = false
  }
}

// a self-scheduled watcher wakes for its due rows, or once FALLBACK_MS after its last run when nothing is pending.
// A table that can't be read right now (the watcher is writing it) is tried again next tick.
// boot: its first wake since Hive started, which always happens and says how long Hive was closed
type Wake = { due: Wakeup[]; startup?: { lastSeen: number | null } }
function selfWake(dir: string, s: WatcherState, boot: boolean): Wake | null {
  const now = Date.now()
  try {
    const { due, next } = readWakeups(dir, now)
    if (boot) return { due, startup: { lastSeen } }
    if (due.length) return { due }
    return next === null && now - (s.runs.at(-1)?.startedAt ?? 0) >= FALLBACK_MS ? { due: [] } : null
  } catch {
    return null
  }
}
function selfNext(dir: string, s: WatcherState): number | null {
  try {
    const { due, next } = readWakeups(dir, Date.now())
    return due.length ? Date.now() : next ?? (s.runs.at(-1)?.startedAt ?? Date.now()) + FALLBACK_MS
  } catch {
    return null
  }
}

// the run kind's bookkeeping (since + last per kind), without the Watch-only enabled flag
const started = (s: WatcherState, kind: RunKind, at: number) => { const m = markStarted({ ...s, enabled: true }, kind, at); return { since: m.since, last: m.last } }

// one run: a new turn in the watcher's thread, or a new (or resumed) thread when none is live. '' = started
// wake: a self-scheduled wake-up; an existing thread then gets only the wake message, not the run header
// a watcher thread past this many tokens of context gets a fresh one at its next run: HIVE_WATCHER_ROTATE_CONTEXT in
// Hive's settings (default 150000; not a positive number = the default)
let rotateTokens = 150_000
const rotateTokensOf = (v?: string) => (Number(v) > 0 ? Number(v) : 150_000)

function startRun(id: string, w: WatcherFile, c: WatchConfig, s: WatcherState, kind: RunKind, wake?: Wake): string {
  const now = new Date()
  const f = foldersOf(id, c.dir, reportsRoot, w.name)
  const prev = s.runs.at(-1) ?? null
  const runId = `${id}-${kind}-${now.getTime()}`
  let text: string
  try {
    text = readFileSync(c.prompt, 'utf8')
  } catch (e) {
    // recorded as a run so the list shows why, and counted so it is not retried every tick
    const error = `Cannot read the prompt file ${c.prompt}: ${(e as Error).message}`
    saveState(id, { ...s, ...started(s, kind, now.getTime()), runs: [...s.runs, { id: runId, tabId: s.tabId ?? '', kind, startedAt: now.getTime(), endedAt: now.getTime(), error }] })
    return error
  }
  mkdirSync(f.memory, { recursive: true })
  mkdirSync(f.reports, { recursive: true })
  // a thread grown past rotateTokens starts again fresh: every run re-reads the whole thread (cache reads still count
  // against the limits, and a cold cache re-writes all of it), while what carries over lives in its memory folder and db
  if (s.sessionId) {
    const st = s.tabId ? deps.threadState(s.tabId) : null
    const ctx = lastContextTokens(deps.transcript(cwdOf(w), s.sessionId))
    if (ctx && ctx > rotateTokens && !st?.working && !st?.waitingReason) {
      if (s.tabId) deps.closeThread(s.tabId)
      s = { ...s, tabId: null, sessionId: null, promptSent: null }
    }
  }
  const live = s.tabId ? deps.threadState(s.tabId) : null
  const fresh = !s.sessionId // no Claude session yet: a new thread
  const tabId = s.tabId && (live || s.sessionId) ? s.tabId : `watcher-${id}-${now.getTime()}`
  const hash = textHash(text)
  const changed = fresh || hash !== s.promptSent ? text : null
  const wakeText = (p: string | null) => wake ? wakeMessage({ name: w.name, now, due: wake.due, table: scheduleFile(c.dir), fallbackHours: FALLBACK_MS / 3_600_000, promptFile: c.prompt, prompt: p, startup: wake.startup }) : ''
  // a fresh thread (first run, or rotated) needs the full header; a wake still says which scheduled tasks are due,
  // since they are marked woken below and would otherwise never reach the new thread
  const prompt = wake && !fresh
    ? wakeText(changed)
    : watcherHeader({ name: w.name, kind, now, lastRun: prev, s, f, promptFile: c.prompt, prompt: changed, fresh }) + (wake ? `\n\n${wakeText(null)}` : '')
  const resume = !live && s.sessionId ? s.sessionId : undefined
  if (!deps.runThread({ tabId, cwd: cwdOf(w), title: tabTitle(w), prompt, resume })) return `The ${appName()} window is not ready`
  woke.add(id)
  if (wake) { try { markWoken(c.dir, wake.due.map((r) => r.id), localIso(now)) } catch { /* the watcher sees them still pending */ } }
  const next: WatcherState = {
    ...s, ...started(s, kind, now.getTime()),
    tabId, sessionId: fresh ? null : s.sessionId, promptSent: hash,
    runs: [...s.runs, { id: runId, tabId, kind, startedAt: now.getTime(), ...(s.sessionId ? { sessionId: s.sessionId } : {}) }],
  }
  saveState(id, next)
  return ''
}

// ---- what the IPC and the agent tools call ----

const builtin = (id: string) => builtins.find((b) => b.id === id)

export function runWatcherNow(id: string, kind: RunKind = 'sweep'): string {
  if (TEST_MODE) return blocked('watcher runs')
  if (builtin(id)) return `${id} runs on its own schedule (Settings)`
  const w = readWatcher(id)
  if (!w) return `No watcher "${id}"`
  const { s, running } = settle(id, readState(id))
  if (running) return `${w.name}: its previous turn is still working`
  const msg = startRun(id, w, cfgOf(id, w), s, kind)
  deps.changed?.()
  return msg
}

// off: the thread's session ends (its process closes; the conversation stays openable). on: the next run starts a
// fresh thread, and a sweep-scheduled watcher runs at once
export function setWatcherEnabled(id: string, on: boolean): string {
  const b = builtin(id)
  if (b) { b.setEnabled(on); deps.changed?.(); return '' }
  const w = readWatcher(id)
  if (!w) return `No watcher "${id}"`
  const { s } = settle(id, readState(id))
  if (s.tabId) deps.closeThread(s.tabId)
  const cur = s.runs.at(-1)
  if (cur && !cur.endedAt && !cur.error) cur.endedAt = Date.now()
  saveState(id, { ...s, tabId: null, sessionId: null, promptSent: null })
  saveWatcher(id, { ...w, enabled: on })
  deps.changed?.()
  if (on && !TEST_MODE) setTimeout(() => void tick(), 500)
  return ''
}

export function createWatcher(input: WatcherInput, by: string): { id: string; message: string } {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('A watcher needs a name')
  const goal = (input.goal ?? '').trim()
  if (!goal && !input.prompt?.trim()) throw new Error('A watcher needs a goal (or a prompt)')
  const sch = normalizeSchedule(input.schedule ?? undefined)
  if (sch.problems.length) throw new Error(`Schedule: ${sch.problems.join('; ')}`)
  const root = watchersRoot()
  mkdirSync(root, { recursive: true })
  let taken: string[] = []
  try { taken = readdirSync(root) } catch { /* empty */ }
  const id = watcherId(name, taken)
  const dir = dirOf(id)
  mkdirSync(join(dir, 'memory'), { recursive: true })
  mkdirSync(join(dir, 'reports'), { recursive: true })
  writeFileSync(join(dir, 'prompt.md'), input.prompt?.trim() ? input.prompt.trim() + '\n' : defaultPrompt(name, goal))
  if (!existsSync(join(dir, 'findings.jsonl'))) writeFileSync(join(dir, 'findings.jsonl'), '')
  const enabled = input.enabled !== false
  saveWatcher(id, { name, goal, enabled, schedule: sch.schedule, cwd: (input.cwd ?? '').trim(), prompt: 'prompt.md', createdBy: by, createdAt: new Date().toISOString() })
  saveState(id, emptyState())
  let message = ''
  if (enabled) message = TEST_MODE ? 'test mode: not started' : runWatcherNow(id, 'sweep')
  deps.changed?.()
  return { id, message }
}

// changes what is given; prompt replaces the prompt file's text (the thread gets it with its next run);
// enabled goes through the switch (ends or starts the session)
export function updateWatcher(id: string, input: WatcherInput): string {
  const w = readWatcher(id)
  if (!w) throw new Error(`No watcher "${id}"`)
  const next = { ...w }
  if (input.name !== undefined && input.name.trim()) next.name = input.name.trim()
  if (input.goal !== undefined) next.goal = input.goal.trim()
  if (input.cwd !== undefined) next.cwd = input.cwd.trim()
  if (input.schedule !== undefined) {
    // fields left out (or undefined) keep their current value
    const given = Object.fromEntries(Object.entries(input.schedule && typeof input.schedule === 'object' ? input.schedule : {}).filter(([, v]) => v !== undefined))
    const merged = typeof input.schedule === 'string' ? { every: input.schedule } : { ...w.schedule, ...given }
    const sch = normalizeSchedule(merged)
    if (sch.problems.length) throw new Error(`Schedule: ${sch.problems.join('; ')}`)
    next.schedule = sch.schedule
  }
  if (input.prompt !== undefined && input.prompt.trim()) writeFileSync(cfgOf(id, w).prompt, input.prompt.trim() + '\n')
  saveWatcher(id, next)
  if (input.enabled !== undefined && input.enabled !== w.enabled) return setWatcherEnabled(id, input.enabled)
  // a new schedule counts at once: the next run shown is computed from it, and a run it makes due starts now
  if (JSON.stringify(next.schedule) !== JSON.stringify(w.schedule) && next.enabled && !TEST_MODE) setTimeout(() => void tick(), 500)
  deps.changed?.()
  return ''
}

// soft delete: the thread ends and the folder moves to watchers/_deleted/<id>-<time>
export function deleteWatcher(id: string): string {
  const w = readWatcher(id)
  if (!w) throw new Error(`No watcher "${id}"`)
  const s = readState(id)
  if (s.tabId) deps.closeThread(s.tabId)
  const bin = join(watchersRoot(), '_deleted')
  mkdirSync(bin, { recursive: true })
  const to = join(bin, `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  renameSync(dirOf(id), to)
  deps.changed?.()
  return to
}

// ---- views ----

function listReports(dir: string): WatcherDetail['reports'] {
  const out: WatcherDetail['reports'] = []
  const walk = (d: string) => {
    let names: string[]
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      try {
        const st = statSync(p)
        if (st.isDirectory()) walk(p)
        else if (/\.(html?|md)$/i.test(n)) out.push({ path: p, name: p.slice(dir.length + 1), mtime: st.mtimeMs })
      } catch { /* gone meanwhile */ }
    }
  }
  walk(dir)
  return out.sort((a, b) => b.mtime - a.mtime)
}
const findingsOf = (file: string) => { try { return parseFindings(readFileSync(file, 'utf8')) } catch { return [] } }

function summary(id: string, w: WatcherFile, p: Plan, u: Awaited<ReturnType<Usage>> | null): WatcherSummary {
  const { s } = settle(id, readState(id))
  const t = s.tabId ? deps.threadState(s.tabId) : null
  const last = s.runs.at(-1)
  const problems: string[] = []
  if (!existsSync(p.c.prompt)) problems.push(`No prompt file at ${p.c.prompt}`)
  if (p.tier && p.tier.pct === null && u) problems.push(`Weekly usage unreadable (${u.error || 'unknown'}): using the slowest tier`)
  return {
    id, name: w.name, goal: w.goal, enabled: w.enabled,
    status: statusOf(w.enabled, t, last), waitingReason: t?.waitingReason ?? '',
    message: [...problems, last?.error ?? ''].filter(Boolean).join('. '),
    lastRun: last?.startedAt ?? null,
    nextRun: !w.enabled ? null : w.schedule.every === 'self' ? selfNext(p.c.dir, s) : earliest(nextRuns(new Date(), p.c, { ...s, enabled: true })),
    schedule: w.schedule, tier: p.tier,
    findings: findingsOf(join(p.c.dir, 'findings.jsonl')).length,
    tabId: s.tabId, sessionId: s.sessionId, dir: p.c.dir, prompt: p.c.prompt,
  }
}

export async function listWatchersView(): Promise<WatchersList> {
  const ws = watcherIds().map((id) => [id, readWatcher(id)] as const).filter((x): x is [string, WatcherFile] => !!x[1])
  const u = ws.some(([, w]) => w.schedule.every === 'adaptive') ? await readUsage() : null
  const out: WatcherSummary[] = []
  for (const [id, w] of ws) out.push(summary(id, w, await plan(id, w, u), u))
  for (const b of builtins) { const x = b.summary(); if (x) out.push(x) }
  return { root: watchersRoot(), watchers: out, problems: migration, testMode: TEST_MODE }
}

export async function watcherDetail(id: string): Promise<WatcherDetail | null> {
  const w = readWatcher(id)
  if (!w) return null
  const u = w.schedule.every === 'adaptive' ? await readUsage() : null
  const p = await plan(id, w, u)
  const sm = summary(id, w, p, u)
  const cwd = cwdOf(w)
  return {
    ...sm,
    findingsList: findingsOf(join(p.c.dir, 'findings.jsonl')),
    reports: listReports(reportsDir(id, w)),
    runs: [...readState(id).runs].reverse().map((r) => ({ ...r, cwd, path: r.sessionId ? deps.transcript(cwd, r.sessionId) : null })),
  }
}

// the agent tools' text for list_watchers
export async function formatWatchers(): Promise<string> {
  const l = await listWatchersView()
  if (!l.watchers.length) return `No watchers yet (folder ${l.root}). create_watcher makes one.`
  const when = (t: number | null) => (t ? new Date(t).toLocaleString() : '-')
  return l.watchers.map((w) => [
    `${w.id}${w.builtin ? ' (built in)' : ''}: ${w.name} [${w.enabled ? 'on' : 'off'}, ${w.status}${w.waitingReason ? `: ${w.waitingReason}` : ''}]`,
    w.goal && `  goal: ${w.goal}`,
    `  schedule: ${JSON.stringify(w.schedule)}${w.tier ? ` (tier ${w.tier.index + 1}, weekly use ${w.tier.pct === null ? 'unknown' : `${Math.round(w.tier.pct)}%`})` : ''}`,
    `  last run: ${when(w.lastRun)}; next: ${when(w.nextRun)}; findings: ${w.findings}`,
    w.dir && `  folder: ${w.dir}`,
    w.message && `  note: ${w.message}`,
  ].filter(Boolean).join('\n')).join('\n') + (l.problems.length ? `\n${l.problems.join('\n')}` : '')
}
