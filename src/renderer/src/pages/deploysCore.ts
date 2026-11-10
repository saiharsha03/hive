// The Deploys page's pure parts: which zone each wizard phase shows, the three stages and their connectors, the
// commits that will ship, the live log's lines, the all-repos matrix and this session's deploy history.
// No React and no I/O. The wizard itself (shared/deployWizard) stays as it is; this only reads its state.
import { commitsFor, type Commit, type DeploySuite, type StatusCell, type Target } from '../../../shared/deployCore'
import type { Phase, Step, Wizard } from '../../../shared/deployWizard'
import type { Tone } from '../kit'

export type Word = { word: string; tone: Tone }

// ---- phases to zones ----
// pick: nothing chosen yet. load: reading git state. review: the changelog to post and the approval. ask: one yes/stop
// question. run: a push is going out, or being watched, or needs you (stuck, manual, failed). end: done or stopped.
export type Zone = 'pick' | 'load' | 'review' | 'ask' | 'run' | 'end'
export const ZONE_OF: Record<Phase, Zone> = {
  pick: 'pick', loading: 'load', review: 'review', ask: 'ask',
  deploying: 'run', watching: 'run', stuck: 'run', manual: 'run', failed: 'run', done: 'end', stopped: 'end',
}
export const zoneOf = (w: Wizard): Zone => ZONE_OF[w.phase]

const pendingStep = (w: Wizard): Step | undefined => w.steps.find((s, i) => i > w.cur && s.status === 'pending')
// Stop is offered everywhere but before a pick and after the end (the old panel's rule)
export const canStop = (w: Wizard) => w.phase !== 'pick' && w.phase !== 'done' && w.phase !== 'stopped'

// the environment the wizard is working towards, null when there is none yet or any more
export function targetOf(w: Wizard): Target | null {
  switch (w.phase) {
    case 'pick': return null
    case 'loading': return w.suite ? (w.toProd ? 'prod' : 'staging') : null
    case 'review': return 'staging'
    case 'ask': return w.toProd ? 'prod' : (pendingStep(w)?.env ?? 'staging')
    case 'deploying': case 'watching': case 'stuck': case 'manual': case 'failed': return w.steps[w.cur]?.env ?? null
    case 'done': case 'stopped': return [...w.steps].reverse().find((s) => s.status !== 'skipped')?.env ?? null
  }
}

// the repo the stages talk about: the one being pushed, the next to push, else the first with something to ship
export function focusRepo(w: Wizard): string {
  const cur = w.steps[w.cur]
  if (cur) return cur.repo
  const next = w.steps.find((s) => s.status === 'pending')
  if (next) return next.repo
  const withCommits = w.diffs.find((d) => !d.error && (d.toStaging.length || d.toProd.length))
  return withCommits?.repo ?? w.groups.api[0] ?? w.groups.web[0] ?? ''
}

export const commitsWord = (n: number) => `${n} ${n === 1 ? 'commit' : 'commits'}`
const short = (sha: string | undefined) => (sha ?? '').slice(0, 7)

// ---- the three stages ----
export type StageKey = 'main' | 'staging' | 'prod'
export type Stage = { key: StageKey; name: string; state: Word; sha: string; line: string; rule: 'done' | 'wait' | 'work' | 'fail' | 'idle'; on: boolean }
export type Connector = { label: string; on: boolean }
export type Stages = { focus: string; stages: [Stage, Stage, Stage]; connectors: [Connector, Connector] }

const WORD = {
  at: { word: 'AT', tone: 'done' }, landed: { word: 'LANDED', tone: 'done' }, behind: { word: 'BEHIND', tone: 'wait' },
  deploying: { word: 'DEPLOYING', tone: 'work' }, failed: { word: 'FAILED', tone: 'fail' },
} satisfies Record<string, Word>
const RULE: Partial<Record<Tone, Stage['rule']>> = { done: 'done', wait: 'wait', work: 'work', fail: 'fail' }

const countOf = (w: Wizard, env: Target) => w.diffs.reduce((n, d) => n + commitsFor(d, env).length, 0)

// null while there is nothing to draw (no suite picked, git state still loading)
export function stagesOf(w: Wizard, clock: (t: number) => string): Stages | null {
  if (w.phase === 'pick' || w.phase === 'loading' || !w.diffs.length) return null
  const focus = focusRepo(w)
  const d = w.diffs.find((x) => x.repo === focus)
  const target = targetOf(w)
  const nStaging = countOf(w, 'staging')
  const nProd = countOf(w, 'prod')
  const cur = w.steps[w.cur]
  const stage = (key: 'staging' | 'prod', behind: boolean, ahead: string, sha: string | undefined): Stage => {
    const mine = w.steps.find((s) => s.repo === focus && s.env === key && s.status !== 'skipped')
    let state: Word = behind ? WORD.behind : WORD.landed
    let line = behind ? ahead : 'Up to date'
    let shown = short(sha)
    if (mine && (mine.status === 'landed' || mine.status === 'confirmed')) {
      state = WORD.landed; shown = short(mine.sha) || shown
      line = mine.endedAt ? `${mine.status === 'landed' ? 'Landed' : 'Confirmed'} ${clock(mine.endedAt)}` : 'Landed'
    } else if (cur && cur.repo === focus && cur.env === key) {
      if (w.phase === 'deploying' || w.phase === 'watching' || w.phase === 'manual') {
        state = WORD.deploying; shown = short(cur.sha) || shown
        line = w.phase === 'deploying' ? 'Pushing' : w.phase === 'manual' ? 'Pushed, confirm by hand' : 'Checking it landed'
      } else if (w.phase === 'failed' || w.phase === 'stuck') {
        state = WORD.failed; shown = short(cur.sha) || shown
        line = w.phase === 'failed' ? 'Push failed' : 'Not seen live yet'
      }
    }
    return { key, name: key, state, sha: shown, line, rule: RULE[state.tone] ?? 'idle', on: target === key }
  }
  const main: Stage = { key: 'main', name: 'main', state: WORD.at, sha: short(d?.mainSha), line: focus, rule: 'done', on: false }
  const staging = stage('staging', nStaging > 0, `${commitsWord(nStaging)} behind main`, d?.stagingSha)
  const prod = stage('prod', nProd > 0 || nStaging > 0, nProd > 0 ? `${commitsWord(nProd)} behind staging` : 'Waits for staging', d?.prodSha)
  const label = (n: number, t: Target) => (target === t ? `${n} will ship` : commitsWord(n))
  return {
    focus,
    stages: [main, staging, prod],
    connectors: [{ label: label(nStaging, 'staging'), on: target === 'staging' }, { label: label(nProd, 'prod'), on: target === 'prod' }],
  }
}

// ---- the repo tab's state word ----
export function tabState(w: Wizard, suite: DeploySuite): Word | null {
  if (!suite.api.length && !suite.web.length) return { word: 'NO TARGETS', tone: 'idle' }
  if (w.suite !== suite.id) return null
  switch (w.phase) {
    case 'failed': case 'stuck': return WORD.failed
    case 'deploying': case 'watching': case 'manual': return WORD.deploying
    case 'review': case 'ask': {
      const left = countOf(w, 'staging') + countOf(w, 'prod')
      const t = targetOf(w)
      return left > 0 || w.toProd ? { word: `${(t ?? 'prod').toUpperCase()} WAITING`, tone: 'wait' } : { word: 'IN SYNC', tone: 'done' }
    }
    case 'done': return { word: 'IN SYNC', tone: 'done' }
    case 'stopped': return { word: 'STOPPED', tone: 'idle' }
    default: return null
  }
}

// ---- what will ship ----
export type ShipRow = Commit & { repo: string }
export function shipRows(w: Wizard, target: Target | null): { rows: ShipRow[]; errors: { repo: string; error: string }[]; migrations: string[] } {
  const rows: ShipRow[] = []
  const errors: { repo: string; error: string }[] = []
  const migrations: string[] = []
  if (!target) return { rows, errors, migrations }
  for (const d of w.diffs) {
    if (d.error) { errors.push({ repo: d.repo, error: d.error }); continue }
    const cs = commitsFor(d, target)
    for (const c of cs) rows.push({ ...c, repo: d.repo })
    if (cs.length && d.migrations) migrations.push(d.repo)
  }
  return { rows, errors, migrations }
}
// the first `limit` rows and how many are folded away
export const fold = <T,>(rows: T[], open: boolean, limit = 8): { shown: T[]; more: number } =>
  open || rows.length <= limit ? { shown: rows, more: 0 } : { shown: rows.slice(0, limit), more: rows.length - limit }

// ---- the run column ----
// the wizard's state in one word and a line of text
export function runState(w: Wizard): { word: Word; text: string } | null {
  const cur = w.steps[w.cur]
  const at = cur ? `${cur.repo} to ${cur.env}` : ''
  switch (w.phase) {
    case 'deploying': return { word: WORD.deploying, text: `${at}: pushing` }
    case 'watching': return { word: { word: 'WATCHING', tone: 'work' }, text: `${at}: ${w.note || 'checking it landed'}` }
    case 'stuck': return { word: { word: 'NOT LANDED', tone: 'fail' }, text: w.note }
    case 'manual': return { word: { word: 'CONFIRM', tone: 'wait' }, text: w.question }
    case 'failed': return { word: WORD.failed, text: w.error }
    case 'done': return { word: WORD.landed, text: 'Done' }
    case 'stopped': return { word: { word: 'STOPPED', tone: 'idle' }, text: 'Stopped' }
    default: return null
  }
}
export function stepWord(s: Step, current: boolean): Word {
  switch (s.status) {
    case 'skipped': return { word: 'SKIPPED', tone: 'idle' }
    case 'landed': return WORD.landed
    case 'confirmed': return { word: 'CONFIRMED', tone: 'done' }
    case 'pushed': return { word: 'PUSHED', tone: 'work' }
    default: return current ? WORD.deploying : { word: 'PENDING', tone: 'idle' }
  }
}

// the live log: a leading 13:52 or [13:52:07] becomes the dim time stamp
export type LogLine = { t?: string; text: string }
export function logLines(out: string): LogLine[] {
  const lines = out.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.map((l) => {
    const m = /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.*)$/.exec(l)
    return m ? { t: m[1], text: m[2] } : { text: l }
  })
}

// ---- all repos ----
type EnvStatus = { env: string; api: StatusCell; web: StatusCell }
export type MatrixCell = { word: string; tone: Tone; sha: string }
export type Matrix = { envs: string[]; lines: { repo: string; cells: MatrixCell[] }[] }
export function cellWord(c: StatusCell): MatrixCell {
  const sha = short(c.served)
  if (c.verdict === 'current') return { word: 'IN SYNC', tone: 'done', sha }
  if (c.verdict === 'behind') return { word: 'BEHIND', tone: 'wait', sha }
  return { word: 'UNKNOWN', tone: 'idle', sha }
}
export function matrixOf(cfg: { apiRepo: string; webRepo: string }, rows: EnvStatus[]): Matrix {
  const lines: Matrix['lines'] = []
  if (cfg.apiRepo) lines.push({ repo: cfg.apiRepo, cells: rows.map((r) => cellWord(r.api)) })
  if (cfg.webRepo) lines.push({ repo: cfg.webRepo, cells: rows.map((r) => cellWord(r.web)) })
  return { envs: rows.map((r) => r.env), lines }
}

// ---- this session's history ----
export type HistoryResult = 'landed' | 'confirmed' | 'stuck' | 'failed'
export type HistoryEntry = { key: string; at: number; repo: string; target: Target; sha: string; result: HistoryResult; tookMs: number | null; landedAt: number | null; reason: string }
let history: HistoryEntry[] = []
export const getHistory = (): HistoryEntry[] => history
export const resetHistory = () => { history = [] }

// the entries the wizard's state tells about: finished steps, plus the one that failed or is stuck now
export function historyFrom(w: Wizard): HistoryEntry[] {
  const out: HistoryEntry[] = []
  w.steps.forEach((s, i) => {
    if (!s.startedAt) return
    const base = { key: `${s.repo}-${s.env}-${s.startedAt}`, at: s.startedAt, repo: s.repo, target: s.env, sha: s.sha ?? '' }
    if (s.status === 'landed' || s.status === 'confirmed') out.push({ ...base, result: s.status, tookMs: s.endedAt ? s.endedAt - s.startedAt : null, landedAt: s.endedAt ?? null, reason: '' })
    else if (i === w.cur && w.phase === 'failed') out.push({ ...base, result: 'failed', tookMs: null, landedAt: null, reason: w.error })
    else if (i === w.cur && w.phase === 'stuck') out.push({ ...base, result: 'stuck', tookMs: null, landedAt: null, reason: w.note })
  })
  return out
}
// adds or replaces by key, newest first; true when the list changed
export function recordHistory(w: Wizard): boolean {
  let changed = false
  for (const e of historyFrom(w)) {
    const at = history.findIndex((x) => x.key === e.key)
    if (at < 0) { history.push(e); changed = true } else if (JSON.stringify(history[at]) !== JSON.stringify(e)) { history[at] = e; changed = true }
  }
  if (changed) history = [...history].sort((a, b) => b.at - a.at)
  return changed
}
export const resultWord = (r: HistoryResult): Word =>
  r === 'landed' ? WORD.landed : r === 'confirmed' ? { word: 'CONFIRMED', tone: 'done' } : r === 'stuck' ? { word: 'NOT LANDED', tone: 'fail' } : WORD.failed
