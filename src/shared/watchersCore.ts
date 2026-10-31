// Watchers: many scheduled, self-prompting background threads. Pure logic (watcher.json, its schedule, ids, the run
// header, the default prompt, the legacy Watch migration plan). No I/O, so it can be tested without Electron.
// Each watcher is a folder: watcher.json (what the user or a thread set), the prompt file, memory/, reports/,
// findings.jsonl, and state.json (Hive's own scheduler state). What a watcher looks at is entirely up to its prompt.
import { parseTime } from './dependabotCore'
import { appName } from './appName'
import {
  DAYS, DEFAULT_TIERS, localIso, parseEvery, parseTiers, parseWeekly,
  type Finding, type NextRuns, type RunKind, type Tier, type WatchConfig, type WatchState,
} from './watchCore'

// the schedule as written in watcher.json: every = "adaptive" (weekly usage tiers), "60m" / "2h" / "1d", or "off"
export type Schedule = { every: string; tiers?: string; daily?: string | null; weekly?: string | null }
export type WatcherFile = {
  name: string
  goal: string
  enabled: boolean
  schedule: Schedule
  cwd: string // '' = the workspace root
  prompt: string // the prompt file, relative to the folder (or absolute)
  createdBy: string
  createdAt: string // ISO
}
export type WatcherRun = { id: string; tabId: string; kind: RunKind; startedAt: number; endedAt?: number; sessionId?: string; error?: string }
// Hive's scheduler state: the long-lived thread (tabId + Claude session) and the runs that went into it
export type WatcherState = Omit<WatchState, 'enabled'> & {
  tabId: string | null // the thread's tab; null = no thread yet (the next run starts a fresh one)
  sessionId: string | null
  promptSent: string | null // a hash of the prompt text the thread last got; it is sent again only when it changed
  runs: WatcherRun[]
}

export const DEFAULT_SCHEDULE: Schedule = { every: 'adaptive', tiers: DEFAULT_TIERS, daily: null, weekly: null }
export const emptyState = (): WatcherState => ({ since: null, last: { sweep: null, daily: null, weekly: null }, tabId: null, sessionId: null, promptSent: null, runs: [] })
export const MAX_RUNS = 200

// the folder name: lowercase words joined by "-", unique among the taken ones ("watch", "watch-2", ...)
export function watcherId(name: string, taken: Iterable<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'watcher'
  const used = new Set([...taken].map((x) => x.toLowerCase()))
  if (!used.has(base) && !base.startsWith('_')) return base
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`
}

// a schedule from the user or a thread: "1h" alone means a fixed interval; problems are listed, never thrown
export function normalizeSchedule(v: unknown): { schedule: Schedule; problems: string[] } {
  const problems: string[] = []
  const o = typeof v === 'string' ? { every: v } : (v && typeof v === 'object' ? v as Record<string, unknown> : {})
  const s: Schedule = { ...DEFAULT_SCHEDULE }
  const every = String(o.every ?? '').trim()
  if (every) {
    if (every.toLowerCase() === 'adaptive') s.every = 'adaptive'
    else if (parseEvery(every) === undefined) problems.push(`every: ${every} is not like 60m, 2h, 1d, off or adaptive`)
    else s.every = every
  }
  if (s.every !== 'adaptive') delete s.tiers
  if (o.tiers !== undefined && String(o.tiers).trim()) {
    const t = parseTiers(String(o.tiers))
    if (!t.tiers) problems.push(`tiers: ${t.problem}`)
    else if (s.every === 'adaptive') s.tiers = String(o.tiers).trim()
  }
  const daily = String(o.daily ?? '').trim()
  if (daily && daily !== 'off') { if (parseTime(daily)) s.daily = daily; else problems.push(`daily: ${daily} is not HH:MM`) }
  const weekly = String(o.weekly ?? '').trim()
  if (weekly && weekly !== 'off') { if (parseWeekly(weekly)) s.weekly = weekly; else problems.push(`weekly: ${weekly} is not like "Mon 08:00"`) }
  return { schedule: s, problems }
}

// watcher.json as read from disk; anything missing gets its default
export function normalizeWatcher(j: unknown): WatcherFile | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name.trim()) return null
  return {
    name: o.name.trim(),
    goal: String(o.goal ?? ''),
    enabled: o.enabled !== false,
    schedule: normalizeSchedule(o.schedule).schedule,
    cwd: String(o.cwd ?? ''),
    prompt: String(o.prompt ?? '') || 'prompt.md',
    createdBy: String(o.createdBy ?? ''),
    createdAt: String(o.createdAt ?? ''),
  }
}

export function normalizeState(j: unknown): WatcherState {
  const e = emptyState()
  if (!j || typeof j !== 'object') return e
  const o = j as Record<string, any>
  return {
    since: typeof o.since === 'number' ? o.since : null,
    last: { ...e.last, ...(o.last && typeof o.last === 'object' ? o.last : {}) },
    tabId: typeof o.tabId === 'string' ? o.tabId : null,
    sessionId: typeof o.sessionId === 'string' ? o.sessionId : null,
    promptSent: typeof o.promptSent === 'string' ? o.promptSent : null,
    runs: Array.isArray(o.runs) ? o.runs.filter((r: any) => r && typeof r.id === 'string' && typeof r.startedAt === 'number') : [],
  }
}

const isAbs = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p)
const joinP = (dir: string, name: string) => `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`

// the plan the scheduler works with (the WatchConfig the Watch logic already understands)
export function watcherConfig(dir: string, w: WatcherFile): WatchConfig {
  const adaptive = w.schedule.every === 'adaptive'
  return {
    dir,
    prompt: isAbs(w.prompt) ? w.prompt : joinP(dir, w.prompt),
    cwd: w.cwd,
    everyMs: adaptive ? null : parseEvery(w.schedule.every) ?? null,
    tiers: adaptive ? parseTiers(w.schedule.tiers || DEFAULT_TIERS).tiers ?? parseTiers(DEFAULT_TIERS).tiers : null,
    daily: w.schedule.daily && parseTime(w.schedule.daily) ? w.schedule.daily : null,
    weekly: w.schedule.weekly ? parseWeekly(w.schedule.weekly) : null,
  }
}

// a watcher's settled state for the list
export type WatcherStatus = 'idle' | 'running' | 'waiting' | 'failed' | 'off'
export function statusOf(enabled: boolean, thread: { working: boolean; waitingReason?: string } | null, lastRun: WatcherRun | undefined): WatcherStatus {
  if (thread?.working) return 'running'
  if (thread?.waitingReason) return 'waiting'
  if (!enabled) return 'off'
  if (lastRun?.error) return 'failed'
  return 'idle'
}

export const earliest = (n: NextRuns | null): number | null => {
  const xs = n ? Object.values(n).filter((x): x is number => x !== null) : []
  return xs.length ? Math.min(...xs) : null
}

// a short, stable fingerprint of the prompt text (not cryptographic: only "did it change")
export function textHash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return `${s.length}:${(h >>> 0).toString(16)}`
}

export type Folders = { dir: string; memory: string; reports: string; findings: string; db: string }
export const foldersOf = (id: string, dir: string): Folders => ({
  dir, memory: joinP(dir, 'memory'), reports: joinP(dir, 'reports'), findings: joinP(dir, 'findings.jsonl'), db: joinP(joinP(dir, 'memory'), `${id}.db`),
})

const stamp = (t: number | null | undefined) => (t ? localIso(new Date(t)) : 'none')

// what Hive puts before every run's message: facts about this run and where things go, nothing about what to look at.
// prompt: the prompt file's text, included on a new thread or when it changed since the thread last got it
export function watcherHeader(a: {
  name: string; kind: RunKind; now: Date; lastRun: WatcherRun | null; s: Pick<WatcherState, 'last'>; f: Folders; promptFile: string; prompt: string | null; fresh: boolean
}): string {
  const { name, kind, now, lastRun, s, f, promptFile, prompt, fresh } = a
  return [
    `[${appName()} watcher run: ${name}]`,
    `Run kind: ${kind}${kind === 'weekly' ? ' (also stands in for today\'s daily report)' : ''}`,
    `Now: ${localIso(now)}`,
    `Last run: ${lastRun ? `${lastRun.kind} started ${stamp(lastRun.startedAt)}${lastRun.endedAt ? `, ended ${stamp(lastRun.endedAt)}` : ''}${lastRun.error ? ` (${lastRun.error})` : ''}` : 'none, this is the first run'}`,
    `Last daily report run: ${stamp(s.last.daily)}. Last weekly report run: ${stamp(s.last.weekly)}.`,
    fresh
      ? 'This is a new thread for this watcher. Every later run arrives as a new message in this same thread, so you keep the conversation; '
        + 'a long thread is compacted automatically, and your memory folder is what survives a new thread.'
      : 'Same thread as your earlier runs: what you did before is above (or in your memory if the thread was compacted).',
    `Watcher folder: ${f.dir}`,
    `Memory folder (yours; keep whatever you need between runs): ${f.memory}`,
    `Your SQLite database: ${f.db} (create it on your first run if it does not exist, and keep it maintained).`,
    `Reports folder (daily and weekly reports as .html or .md; ${appName()}'s Watchers view lists them): ${f.reports}`,
    `Findings file (${appName()}'s Watchers view lists it): ${f.findings}. Append one JSON object per line: {"at": ISO time, "title": one line, "why": why it matters, "kind": "good" | "bad" | "info", "link": optional URL or path}.`,
    'When something needs the user\'s attention, also call mcp__hive__organize_thread with action "waiting" and a one-line reason; otherwise just end the run.',
    prompt === null ? `Your instructions are in ${promptFile} (unchanged since you last got them in this thread).` : `Your instructions (from ${promptFile}):`,
    '',
    '---',
    '',
    ...(prompt === null ? [] : [prompt]),
  ].join('\n')
}

// the prompt create_watcher writes when none is given: goals, not procedures
export function defaultPrompt(name: string, goal: string): string {
  return [
    `# ${name}`,
    '',
    `You are ${name}, a watcher: a long-lived background thread in ${appName()} that wakes up on a schedule. Each run arrives as a new`,
    'message in this same thread, with a header that says the run kind, the time, your last run, and where your memory,',
    'database, reports and findings go. Nobody is watching you live; what you leave behind is what counts.',
    '',
    '## Goal',
    '',
    goal.trim() || '(no goal given yet: ask for one by marking the thread as waiting)',
    '',
    '## What good looks like',
    '',
    '- Each run, you know what changed since the last one and whether it matters for the goal.',
    '- You leave a finding only when it is worth the user\'s attention: new, surprising, or needing action. Quiet runs are fine.',
    '- Daily and weekly report runs leave a short, readable report in the reports folder.',
    '- Anything you are unsure about is stated as unsure, not guessed.',
    '',
    '## Memory',
    '',
    'You own a SQLite database in your memory folder (its path is in every run header). Create it on your first run and shape',
    'it however serves the goal: baselines, snapshots, what you already reported, open questions. Keep it maintained: the',
    'thread may be compacted or replaced by a new one, and the database is what carries over. Notes and helper scripts can',
    'live in the memory folder too.',
    '',
    '## Ground rules',
    '',
    '- Write only in your own folder unless the goal says otherwise.',
    '- When the user needs to decide or act, call mcp__hive__organize_thread with action "waiting" and one line on why.',
    '',
  ].join('\n')
}

// ---- the legacy single Watch (HIVE_WATCH_* settings + ~/.claude/hive/watch.json) as watcher "watch" ----

// watcher.json for the old Watch, from its settings; prompt relative when it sat inside the folder
export function legacyWatcher(env: Record<string, string>, dir: string, enabled: boolean, now: Date): WatcherFile {
  const everyRaw = (env.HIVE_WATCH_EVERY ?? '').trim() || '60m'
  const promptRaw = (env.HIVE_WATCH_PROMPT ?? '').trim()
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const inside = promptRaw && norm(promptRaw).startsWith(`${norm(dir)}/`)
  const { schedule } = normalizeSchedule({
    every: everyRaw, tiers: everyRaw.toLowerCase() === 'adaptive' ? (env.HIVE_WATCH_TIERS ?? '').trim() || DEFAULT_TIERS : undefined,
    daily: env.HIVE_WATCH_DAILY, weekly: env.HIVE_WATCH_WEEKLY,
  })
  return {
    name: 'Watch',
    goal: 'The original Watch: keeps an eye on everything its prompt describes.',
    enabled,
    schedule,
    cwd: (env.HIVE_WATCH_CWD ?? '').trim(),
    prompt: !promptRaw ? 'watch.md' : inside ? promptRaw.slice(dir.replace(/[\\/]+$/, '').length + 1) : promptRaw,
    createdBy: 'migrated from Watch',
    createdAt: now.toISOString(),
  }
}

// the old watch.json state as watcher state: runs keep their thread ids (each was its own thread then)
export function legacyState(j: unknown): { state: WatcherState; enabled: boolean } {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, any>
  const runs: WatcherRun[] = (Array.isArray(o.runs) ? o.runs : [])
    .filter((r: any) => r && typeof r.id === 'string' && typeof r.startedAt === 'number')
    .map((r: any) => ({ ...r, tabId: r.id }))
  const s = normalizeState({ since: o.since, last: o.last, runs })
  return { state: { ...s, runs: s.runs.slice(-MAX_RUNS) }, enabled: o.enabled !== false }
}

// what one row of the list shows; detail adds the findings, reports and runs
export type WatcherSummary = {
  id: string
  builtin?: boolean // Dependabot: Hive's own, configured in Settings
  name: string
  goal: string
  enabled: boolean
  status: WatcherStatus
  waitingReason: string
  message: string // a problem to show (bad schedule, missing prompt file, ...)
  lastRun: number | null
  nextRun: number | null
  schedule: Schedule
  tier: { index: number; everyMs: number | null; pct: number | null; tiers: Tier[] } | null // adaptive only
  findings: number
  tabId: string | null
  sessionId: string | null
  dir: string
  prompt: string
}
export type WatcherDetail = WatcherSummary & {
  findingsList: Finding[]
  reports: { path: string; name: string; mtime: number }[]
  runs: (WatcherRun & { path: string | null; cwd: string })[] // newest first; path = the transcript
}
export type WatchersList = { root: string; watchers: WatcherSummary[]; problems: string[]; testMode: boolean }
export type WatcherInput = { name?: string; goal?: string; prompt?: string; schedule?: unknown; cwd?: string; enabled?: boolean }

// ---- the schedule editor (a watcher's detail view): the form's draft, its checks, and the schedule it saves ----

export type ScheduleMode = 'adaptive' | 'fixed' | 'reports' // reports = no sweeps, only the daily / weekly report runs
export type TierRow = { below: string; every: string }
export type ScheduleDraft = { mode: ScheduleMode; tiers: TierRow[]; every: string; daily: string; weeklyDay: string; weeklyTime: string }
// field: 'tiers', 'tier-<i>-below', 'tier-<i>-every', 'every', 'daily', 'weekly', 'reports'
export type DraftError = { field: string; message: string }

export const tierRows = (tiers: string): TierRow[] => tiers.split(',').map((x) => x.trim()).filter(Boolean).map((p) => {
  const i = p.indexOf(':')
  return i < 0 ? { below: p.replace('%', '').trim(), every: '' } : { below: p.slice(0, i).replace('%', '').trim(), every: p.slice(i + 1).trim() }
})

export function draftOf(s: Schedule): ScheduleDraft {
  const fixed = s.every !== 'adaptive' && !!parseEvery(s.every)
  const w = s.weekly ? parseWeekly(s.weekly) : null
  return {
    mode: s.every === 'adaptive' ? 'adaptive' : fixed ? 'fixed' : 'reports',
    tiers: tierRows(s.tiers || DEFAULT_TIERS),
    every: fixed ? s.every : '1h',
    daily: s.daily ?? '',
    weeklyDay: w ? DAYS[w.day] : '',
    weeklyTime: w?.time ?? '',
  }
}

// every problem in the draft (an empty list means it can be saved) and the schedule it saves as
export function checkDraft(d: ScheduleDraft): { errors: DraftError[]; schedule: Schedule | null } {
  const errors: DraftError[] = []
  const err = (field: string, message: string) => errors.push({ field, message })
  if (d.mode === 'adaptive') {
    if (!d.tiers.length) err('tiers', 'Add at least one tier')
    let prev = 0
    d.tiers.forEach((t, i) => {
      const n = Number(t.below)
      if (!/^\d+(\.\d+)?$/.test(t.below.trim()) || n < 1 || n > 100) err(`tier-${i}-below`, `Tier ${i + 1}: the threshold must be a number from 1 to 100`)
      else if (n <= prev) err(`tier-${i}-below`, `Tier ${i + 1}: thresholds must rise (${n} is not above ${prev})`)
      if (Number.isFinite(n)) prev = Math.max(prev, n)
      if (!t.every.trim() || parseEvery(t.every) === undefined) err(`tier-${i}-every`, `Tier ${i + 1}: interval like 30m, 1h, 6h, 1d or off`)
    })
  }
  if (d.mode === 'fixed' && !parseEvery(d.every)) err('every', 'Interval like 30m, 1h, 6h or 1d')
  const daily = d.daily.trim()
  if (daily && !parseTime(daily)) err('daily', 'Daily report time is HH:MM (00:00 to 23:59)')
  const day = d.weeklyDay.trim().toLowerCase(), time = d.weeklyTime.trim()
  if (day && !DAYS.includes(day)) err('weekly', 'Weekly report day is a day of the week')
  else if (day && !parseTime(time)) err('weekly', 'Weekly report time is HH:MM (00:00 to 23:59)')
  else if (!day && time) err('weekly', 'Pick a day for the weekly report')
  if (d.mode === 'reports' && !daily && !day) err('reports', 'Reports only needs a daily or a weekly report time')
  if (errors.length) return { errors, schedule: null }
  const schedule: Schedule = {
    every: d.mode === 'adaptive' ? 'adaptive' : d.mode === 'fixed' ? d.every.trim() : 'off',
    ...(d.mode === 'adaptive' ? { tiers: d.tiers.map((t) => `${t.below.trim()}:${t.every.trim()}`).join(',') } : {}),
    daily: daily || null,
    weekly: day ? `${day[0].toUpperCase()}${day.slice(1)} ${time}` : null,
  }
  // the same checks main runs when it saves; anything left is shown, not sent
  for (const p of normalizeSchedule(schedule).problems) err('schedule', p)
  return errors.length ? { errors, schedule: null } : { errors, schedule }
}
