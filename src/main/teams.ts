// Team threads, files: every team is a folder under ~/.claude/hive/teams/<id>/ with team.json (who is in it),
// plan.md (the lead's plan, rows kept current by their owners), knowledge.md (what the team learned) and log.jsonl
// (every team_post). Plain code; the threads themselves are started by chat.ts.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './testMode'
import { writeFileSafe } from './safeWrite'
import { parseLog, slug, type LogEntry, type Member, type Ref, type Team } from '../shared/teamCore'

export const teamsDir = () => process.env.HIVE_TEAMS_DIR || join(dataDir(), 'hive', 'teams')

let cache: Map<string, Team> | null = null
const listeners = new Set<(teamId: string) => void>()
export const onTeamChange = (f: (teamId: string) => void) => { listeners.add(f); return () => { listeners.delete(f) } }
const changed = (id: string) => { for (const f of listeners) f(id) }
export const teamChanged = changed

function all(): Map<string, Team> {
  if (cache) return cache
  cache = new Map()
  const root = teamsDir()
  if (!existsSync(root)) return cache
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    try {
      const t = JSON.parse(readFileSync(join(root, d.name, 'team.json'), 'utf8')) as Team
      if (t?.id && Array.isArray(t.members)) cache.set(t.id, { ...t, dir: join(root, d.name) })
    } catch { /* not a team folder */ }
  }
  return cache
}

const save = (t: Team) => { writeFileSafe(join(t.dir, 'team.json'), JSON.stringify(t, null, 2)); changed(t.id) }

export const listTeams = (): Team[] => [...all().values()].sort((a, b) => b.createdAt - a.createdAt)
export const getTeam = (id: string): Team | undefined => all().get(id)

// the running team a thread leads or belongs to (an Owner is not in its teams)
export function teamOf(threadId: string): Team | undefined {
  return listTeams().find((t) => !t.endedAt && (t.lead.id === threadId || t.members.some((m) => m.id === threadId)))
}

// the running teams a thread started as Owner
export const ownedTeams = (threadId: string): Team[] => listTeams().filter((t) => !t.endedAt && t.owner?.id === threadId)

export function createTeam(name: string, goal: string, who: { lead: Ref; owner?: Ref }, now = Date.now()): Team {
  const base = `${new Date(now).toISOString().slice(0, 10)}-${slug(name)}`
  let id = base
  for (let i = 2; all().has(id) || existsSync(join(teamsDir(), id)); i++) id = `${base}-${i}`
  const dir = join(teamsDir(), id)
  mkdirSync(dir, { recursive: true })
  const team: Team = { id, name, goal, dir, ...(who.owner ? { owner: who.owner } : {}), lead: who.lead, members: [], createdAt: now }
  writeFileSafe(join(dir, 'plan.md'), `# ${name}\n\nGoal: ${goal}\n\n| Part | Owner | State | Notes |\n|---|---|---|---|\n`)
  writeFileSafe(join(dir, 'knowledge.md'), `# What team "${name}" learned\n\n`)
  writeFileSafe(join(dir, 'log.jsonl'), '')
  all().set(id, team)
  save(team)
  return team
}

export function addMember(team: Team, m: Member): void {
  team.members.push(m)
  save(team)
}

// paused: no turn runs and team posts are only logged, until resumed
export function setPaused(team: Team, at: number | undefined): void {
  if (at) team.pausedAt = at
  else delete team.pausedAt
  save(team)
}

// remember the Claude session of a team thread, so the team can be resumed after Hive restarts
export function noteSession(threadId: string, sessionId: string): void {
  for (const t of listTeams()) {
    if (t.endedAt) continue
    const who = [t.lead, ...t.members, ...(t.owner ? [t.owner] : [])].find((x) => x.id === threadId)
    if (who && who.sessionId !== sessionId) { who.sessionId = sessionId; save(t) }
  }
}

export function endTeam(team: Team, now = Date.now()): void {
  team.endedAt = now
  save(team)
}

export function appendLog(team: Team, e: LogEntry): void {
  appendFileSync(join(team.dir, 'log.jsonl'), `${JSON.stringify(e)}\n`)
  changed(team.id)
}

export function readLog(team: Team): LogEntry[] {
  try { return parseLog(readFileSync(join(team.dir, 'log.jsonl'), 'utf8')) } catch { return [] }
}

export function addKnowledge(team: Team, by: string, text: string, now = Date.now()): void {
  appendFileSync(join(team.dir, 'knowledge.md'), `- ${text.trim().replace(/\n+/g, ' ')} (${by}, ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')})\n`)
  changed(team.id)
}

export const readTeamFile = (team: Team, name: 'plan.md' | 'knowledge.md') => {
  try { return readFileSync(join(team.dir, name), 'utf8') } catch { return '' }
}

// for tests: forget what was read from disk
export const resetTeamsCache = () => { cache = null }
