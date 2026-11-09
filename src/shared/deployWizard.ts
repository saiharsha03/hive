// The Deploy wizard as a pure state machine: step(state, action) -> { state, effect }.
// Every deploy is one explicit click (the 'yes' action); nothing here talks to git, aws or deploy.sh.
// The renderer runs the returned effect; this file only decides what comes next.
import { commitsFor, type Commit, type RepoDiff, type Suite, type Target } from './deployCore'

export type Group = 'api' | 'web'
// a suite's repos by group, from the Hive .env (API repos before web repos)
export type Groups = Record<Group, string[]>

export type StepStatus = 'pending' | 'skipped' | 'pushed' | 'landed' | 'confirmed'
export type Step = { repo: string; group: Group; env: Target; status: StepStatus; commits: Commit[]; sha?: string; startedAt?: number; endedAt?: number }
export type Phase = 'pick' | 'loading' | 'review' | 'ask' | 'deploying' | 'watching' | 'stuck' | 'manual' | 'failed' | 'done' | 'stopped'
export type Wizard = {
  phase: Phase
  suite?: Suite
  groups: Groups // the picked suite's repos
  diffs: RepoDiff[]
  changelog: string
  output: string // diffs.sh stdout, verbatim ('' while showing the local-refs view)
  root: string
  steps: Step[]
  cur: number // index of the step being worked on, -1 before the first
  question: string // what the wizard is asking in 'ask' / 'manual'
  note: string // landed-check progress or the stuck reason
  toProd: boolean // the pending question is "Deploy to prod?"
  watchId: string
  error: string
}
export type Effect =
  | { kind: 'diffs'; suite: Suite; forProd: boolean }
  | { kind: 'deploy'; repo: string; target: Target }
  | { kind: 'watch'; repo: string; target: Target; sha: string }
  | { kind: 'dismiss'; id: string }

export type Action =
  | { t: 'pick'; suite: Suite; groups: Groups }
  | { t: 'diffs'; diffs: RepoDiff[]; changelog: string; output: string; root: string; at: number; local?: boolean }
  | { t: 'refresh'; diffs: RepoDiff[]; changelog: string; output: string; root: string } // diffs.sh is back
  | { t: 'error'; error: string }
  | { t: 'next' } // "I have team approval"
  | { t: 'yes'; at: number }
  | { t: 'stop' }
  | { t: 'deployEnd'; ok: boolean; message: string; sha: string; watchId: string; at: number }
  | { t: 'watchId'; id: string }
  | { t: 'watchNote'; note: string }
  | { t: 'watchDone'; landed: boolean; note: string; at: number }
  | { t: 'retry'; at: number }
  | { t: 'confirmManual'; at: number }
  | { t: 'reset' }

export const initial = (): Wizard => ({ phase: 'pick', groups: { api: [], web: [] }, diffs: [], changelog: '', output: '', root: '', steps: [], cur: -1, question: '', note: '', toProd: false, watchId: '', error: '' })

export function planSteps(groups: Groups, diffs: RepoDiff[], env: Target): Step[] {
  const steps: Step[] = []
  for (const group of ['api', 'web'] as const) {
    for (const repo of groups[group]) {
      const d = diffs.find((x) => x.repo === repo)
      const commits = d ? commitsFor(d, env) : []
      steps.push({ repo, group, env, commits, status: commits.length ? 'pending' : 'skipped' })
    }
  }
  return steps
}

const nextPending = (steps: Step[], from: number) => steps.findIndex((s, i) => i > from && s.status === 'pending')
const label = (g: Group) => (g === 'api' ? 'API' : 'web')

// the yes/stop question before step idx
export function questionFor(steps: Step[], idx: number): string {
  const s = steps[idx]
  const prev = [...steps.slice(0, idx)].reverse().find((x) => x.env === s.env && x.status !== 'skipped' && x.status !== 'pending')
  if (!prev) return `Start the ${label(s.group)} deploy to ${s.env}? (${s.repo}, ${s.commits.length} commit${s.commits.length === 1 ? '' : 's'})`
  if (prev.group === 'api' && s.group === 'web') return `API is live on ${s.env}. Go ahead with web? (${s.repo}, ${s.commits.length} commit${s.commits.length === 1 ? '' : 's'})`
  return `${prev.repo} is done on ${s.env}. Next: ${s.repo} (${s.commits.length} commit${s.commits.length === 1 ? '' : 's'})?`
}

// the step finished (landed or confirmed): ask about the next one, or about prod, or finish
function advance(w: Wizard, steps: Step[]): { state: Wizard; effect?: Effect } {
  const n = nextPending(steps, w.cur)
  if (n >= 0) return { state: { ...w, steps, phase: 'ask', question: questionFor(steps, n), toProd: false, watchId: '', note: '' } }
  const hasProd = steps.some((s) => s.env === 'prod')
  if (hasProd) return { state: { ...w, steps, phase: 'done', question: '', watchId: '', note: '' } }
  const any = steps.some((s) => s.status !== 'skipped')
  return { state: { ...w, steps, phase: 'ask', toProd: true, question: any ? 'Staging done. Deploy to prod?' : 'Nothing to deploy to staging. Continue to prod?', watchId: '', note: '' } }
}

const begin = (w: Wizard, steps: Step[], idx: number, at: number) => {
  const s = steps.map((x, i) => (i === idx ? { ...x, startedAt: at } : x))
  return { state: { ...w, steps: s, cur: idx, phase: 'deploying' as const, question: '', note: '', error: '', watchId: '' }, effect: { kind: 'deploy' as const, repo: s[idx].repo, target: s[idx].env } }
}

export function step(w: Wizard, a: Action): { state: Wizard; effect?: Effect } {
  const cur = w.steps[w.cur]
  switch (a.t) {
    case 'reset': return { state: initial(), effect: w.watchId ? { kind: 'dismiss', id: w.watchId } : undefined }
    case 'pick':
      return w.phase === 'pick' ? { state: { ...initial(), phase: 'loading', suite: a.suite, groups: a.groups }, effect: { kind: 'diffs', suite: a.suite, forProd: false } } : { state: w }
    case 'error':
      // diffs.sh failing behind the local view: keep the local view, say why it was not refreshed
      if (w.phase === 'review') return { state: { ...w, note: '', error: a.error } }
      return { state: { ...w, phase: w.phase === 'loading' && w.steps.length === 0 ? 'pick' : 'failed', error: a.error } }
    case 'refresh':
      // only while still reviewing staging; once a deploy started, the plan is not swapped underneath it
      if (w.phase !== 'review' || w.toProd) return { state: w }
      return { state: { ...w, diffs: a.diffs, changelog: a.changelog, output: a.output, root: a.root, steps: planSteps(w.groups, a.diffs, 'staging'), note: '', error: '' } }
    case 'diffs': {
      if (w.phase !== 'loading' || !w.suite) return { state: w }
      if (!w.toProd) return { state: { ...w, phase: 'review', diffs: a.diffs, changelog: a.changelog, output: a.output, root: a.root, steps: planSteps(w.groups, a.diffs, 'staging'), note: a.local ? 'From local refs, refreshing with diffs.sh...' : '' } }
      // entering prod: replan from fresh refs (staging now holds what was just pushed), then the "Yes" already given starts the first prod step
      const prod = planSteps(w.groups, a.diffs, 'prod')
      const steps = [...w.steps, ...prod]
      const n = steps.findIndex((s, i) => i >= w.steps.length && s.status === 'pending')
      const base = { ...w, diffs: a.diffs, output: a.output, toProd: false }
      if (n < 0) return { state: { ...base, steps, phase: 'done' } }
      return begin(base, steps, n, a.at)
    }
    case 'next':
      if (w.phase !== 'review') return { state: w }
      return advance({ ...w, cur: -1 }, w.steps)
    case 'yes': {
      if (w.phase !== 'ask') return { state: w }
      if (w.toProd) return { state: { ...w, phase: 'loading', question: '' }, effect: { kind: 'diffs', suite: w.suite!, forProd: true } }
      return begin(w, w.steps, nextPending(w.steps, w.cur), a.at)
    }
    case 'deployEnd': {
      if (w.phase !== 'deploying' || !cur) return { state: w }
      if (!a.ok) return { state: { ...w, phase: 'failed', error: a.message } }
      const steps = w.steps.map((s, i) => (i === w.cur ? { ...s, status: 'pushed' as const, sha: a.sha } : s))
      if (a.watchId) return { state: { ...w, steps, phase: 'watching', watchId: a.watchId, note: 'starting' } }
      return { state: { ...w, steps, phase: 'manual', note: a.message, question: `${cur.repo} pushed to ${cur.env}; landed check not available, confirm manually.` } }
    }
    case 'watchId': return { state: { ...w, watchId: a.id } }
    case 'watchNote':
      return w.phase === 'watching' ? { state: { ...w, note: a.note } } : { state: w }
    case 'watchDone': {
      if (w.phase !== 'watching' || !cur) return { state: w }
      const dismiss = w.watchId ? { kind: 'dismiss' as const, id: w.watchId } : undefined
      if (!a.landed) return { state: { ...w, phase: 'stuck', note: a.note }, effect: dismiss }
      const steps = w.steps.map((s, i) => (i === w.cur ? { ...s, status: 'landed' as const, endedAt: a.at } : s))
      return { ...advance(w, steps), effect: dismiss }
    }
    case 'retry': {
      if (w.phase === 'stuck' && cur?.sha) return { state: { ...w, phase: 'watching', note: 'retrying', watchId: '' }, effect: { kind: 'watch', repo: cur.repo, target: cur.env, sha: cur.sha } }
      if (w.phase === 'failed' && w.toProd) return { state: { ...w, phase: 'ask', error: '', question: 'Staging done. Deploy to prod?' } }
      if (w.phase === 'failed' && cur) return begin(w, w.steps, w.cur, a.at)
      return { state: w }
    }
    case 'confirmManual': {
      if (w.phase !== 'manual' || !cur) return { state: w }
      return advance(w, w.steps.map((s, i) => (i === w.cur ? { ...s, status: 'confirmed' as const, endedAt: a.at } : s)))
    }
    case 'stop':
      if (w.phase === 'pick' || w.phase === 'done' || w.phase === 'stopped') return { state: w }
      return { state: { ...w, phase: 'stopped', question: '' }, effect: w.watchId ? { kind: 'dismiss', id: w.watchId } : undefined }
  }
}

// a watcher the wizard waits on while it deploys or watches (the Working dot) or asks (the Waiting dot)
export function wizardRow(w: Wizard): { title: string; state: 'working' | 'waiting'; note: string } | null {
  const s = w.steps[w.cur]
  const at = s ? `${s.repo} → ${s.env}` : ''
  switch (w.phase) {
    case 'deploying': return { title: at, state: 'working', note: 'pushing' }
    case 'watching': return { title: at, state: 'working', note: w.note }
    case 'ask': return { title: `Deploy ${w.suite}`, state: 'waiting', note: w.question }
    case 'manual': return { title: at, state: 'waiting', note: w.question }
    case 'stuck': return { title: at, state: 'waiting', note: w.note }
    case 'failed': return { title: at || `Deploy ${w.suite}`, state: 'waiting', note: `failed: ${w.error}` }
    default: return null
  }
}

export const wizardBusy = (w: Wizard) => w.phase === 'deploying'

export type SummaryLine = { repo: string; env: Target; sha: string; status: StepStatus; ms: number | null }
export const summary = (w: Wizard): SummaryLine[] =>
  w.steps.filter((s) => s.status === 'landed' || s.status === 'confirmed' || s.status === 'pushed').map((s) => ({ repo: s.repo, env: s.env, sha: (s.sha ?? '').slice(0, 7), status: s.status, ms: s.startedAt && s.endedAt ? s.endedAt - s.startedAt : null }))

export const fmtDuration = (ms: number | null) => (ms === null ? '' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)
