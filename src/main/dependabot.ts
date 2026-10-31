// Dependabot watcher, main process: plain code. Once a day at the configured local time (or at the first start after
// a missed one) it lists open Dependabot PRs with `gh` (read-only) and starts one background review thread per PR that
// is new or has a new head since its last review. It never merges or comments; the review prompt tells the threads the same.
// No Electron imports: the thread starter is passed in.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WatcherSummary } from '../shared/watchersCore'
import {
  isDue, lastSlot, needsReview, parseDependabotConfig, parsePrList, prKey, reviewPrompt, reviewTitle,
  type DependabotConfig, type OpenPr, type Reviewed,
} from '../shared/dependabotCore'
import { dataDir, TEST_MODE } from './testMode'
import { writeFileSafe } from './safeWrite'

type State = { lastRun: number | null; reviewed: Reviewed; enabled?: boolean } // enabled: the Watchers view's switch (default on)
export type StartReview = (t: { tabId: string; cwd: string; title: string; prompt: string }) => boolean // false: no window yet

const FILE = join(dataDir(), 'hive', 'dependabot.json')

function load(): State {
  try { const j = JSON.parse(readFileSync(FILE, 'utf8')); return { lastRun: j.lastRun ?? null, reviewed: j.reviewed ?? {}, enabled: j.enabled !== false } } catch { return { lastRun: null, reviewed: {}, enabled: true } }
}
function save(s: State) {
  writeFileSafe(FILE, JSON.stringify(s, null, 2) + '\n')
}

const gh = (args: string[]) =>
  new Promise<string>((ok, bad) => {
    execFile('gh', args, { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      (err ? bad(new Error((stderr || err.message).toString().trim().split('\n')[0])) : ok(stdout.toString())))
  })

// read-only: every open Dependabot PR in the configured repos
export async function listDependabotPrs(c: DependabotConfig): Promise<{ prs: OpenPr[]; errors: string[] }> {
  const prs: OpenPr[] = []
  const errors: string[] = []
  await Promise.all(c.repos.map(async (repo) => {
    try {
      const out = await gh(['pr', 'list', '-R', repo, '--author', c.author, '--state', 'open', '--limit', '1000', '--json', 'number,title,url,headRefName,headRefOid,updatedAt'])
      prs.push(...parsePrList(repo, out))
    } catch (e) {
      errors.push(`${repo}: ${(e as Error).message}`)
    }
  }))
  prs.sort((a, b) => prKey(a).localeCompare(prKey(b)))
  return { prs, errors }
}

let cfg: DependabotConfig | null = null
let root = ''
let busy = false

// called again when the settings change: the timer runs once and reads the latest config on every tick
let timers = false
export function initDependabot(env: Record<string, string>, workspaceRoot: string, startReview: StartReview) {
  if (TEST_MODE) return
  const p = parseDependabotConfig(env)
  cfg = p.config
  root = workspaceRoot
  if (!cfg || !root) { cfg = null; return }
  if (p.problems.length) console.warn(`Dependabot watcher: ${p.problems.join('; ')}`)
  if (timers) return
  timers = true
  const tick = () => void runIfDue(startReview)
  setTimeout(tick, 60_000) // after the window has loaded (a reload stops every live thread)
  setInterval(tick, 60_000).unref()
}

async function runIfDue(startReview: StartReview) {
  if (!cfg || busy) return
  const state = load()
  if (state.enabled === false) return
  const now = new Date()
  if (!isDue(now, state.lastRun, cfg.time)) return
  busy = true
  try {
    const { prs, errors } = await listDependabotPrs(cfg)
    if (errors.length) console.warn(`Dependabot watcher: ${errors.join('; ')}`)
    if (errors.length === cfg.repos.length) return // offline or gh logged out: try again on the next tick
    for (const pr of prs.filter((x) => needsReview(x, state.reviewed))) {
      const local = join(root, pr.repo.split('/')[1])
      const started = startReview({
        tabId: `dependabot-${pr.repo.replace(/\W+/g, '-')}-${pr.number}-${Date.now()}`, cwd: root,
        title: reviewTitle(pr), prompt: reviewPrompt(pr, existsSync(local) ? local : null),
      })
      if (!started) return // no window yet: try again on the next tick, nothing recorded
      state.reviewed[prKey(pr)] = { head: pr.head, at: Date.now(), title: pr.title }
      save(state)
    }
    state.lastRun = now.getTime()
    save(state)
  } finally {
    busy = false
  }
}

// the Watchers view's switch for this built-in watcher
export function setDependabotEnabled(on: boolean): void {
  save({ ...load(), enabled: on })
}

// one row of the Watchers view
export function dependabotSummary(): WatcherSummary {
  const s = load()
  const on = s.enabled !== false
  const next = cfg ? lastSlot(new Date(), cfg.time).getTime() + 86_400_000 : null
  return {
    id: 'dependabot', builtin: true, name: 'Dependabot',
    goal: cfg ? `Reviews new Dependabot PRs in ${cfg.repos.join(', ')} once a day (one background thread per PR)` : 'Reviews new Dependabot PRs once a day',
    enabled: on, status: busy ? 'running' : on ? 'idle' : 'off', waitingReason: '',
    message: cfg ? '' : 'Not set up: add repos under Settings > Dependabot watcher.',
    lastRun: s.lastRun, nextRun: on && cfg ? (isDue(new Date(), s.lastRun, cfg.time) ? Date.now() : next) : null,
    schedule: { every: 'off', daily: cfg?.time ?? null, weekly: null }, tier: null,
    findings: Object.keys(s.reviewed).length, tabId: null, sessionId: null, dir: '', prompt: '',
  }
}
