// Team threads: real threads (teammates) that work on one job together. A thread starts a team either as its Lead
// or as its Owner only (a new Lead thread runs it and reports back); one thread can own several unrelated teams.
// Roles repeat freely (three builders, two reviewers). They share a folder (team.json, plan.md, knowledge.md,
// log.jsonl) and talk through team_post, to anyone directly. Pure parts here: shapes, briefs, addressing, status text.
// Files live in main/teams.ts, threads in main/chat.ts.

import type { Todo } from './teamTodoCore'

export const MAX_TEAMMATES = 10

export type Ref = { id: string; title: string; cwd?: string; sessionId?: string } // sessionId: to resume the thread after Hive restarts
export type Member = { id: string; name: string; role: string; cwd: string; joinedAt: number; sessionId?: string }
export type Team = { id: string; name: string; goal: string; dir: string; owner?: Ref; lead: Ref; members: Member[]; createdAt: number; endedAt?: number; pausedAt?: number }
export type LogEntry = { at: number; from: string; fromName: string; to: string[]; text: string } // to [] = posted to the board only
export type MemberState = 'working' | 'waiting' | 'idle' | 'closed'
// reply: the member thread's last final reply (trimmed), at: when it finished
export type MemberStatus = { state: MemberState; doing?: string; reply?: string; at?: number }
export type TeamView = { team: Team; states: Record<string, MemberStatus>; log: LogEntry[]; plan: string; knowledge: string; todos: Todo[] }

// short, readable id part: "Builder helix-api" -> "builder-helix-api"
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'mate'

const RESERVED = new Set(['lead', 'owner', 'all', 'you', 'user'])
export const nameTaken = (team: Team, name: string) => {
  const n = name.trim().toLowerCase()
  return !n || RESERVED.has(n) || team.members.some((m) => m.name.toLowerCase() === n)
}

const plural = (r: string) => r.replace(/s$/, '')

// who a post to `ref` reaches: "Lead", "Owner", "all", a name, a thread id, or a role ("builder" / "builders" = every builder)
export function targetsOf(team: Team, ref: string): { id: string; name: string }[] {
  const r = ref.trim().toLowerCase()
  const everyone = [{ id: team.lead.id, name: 'Lead' }, ...team.members.map((m) => ({ id: m.id, name: m.name }))]
  if (r === 'all' || r === 'everyone') return everyone
  if (r === 'lead' || r === team.lead.id.toLowerCase()) return [{ id: team.lead.id, name: 'Lead' }]
  if (team.owner && (r === 'owner' || r === team.owner.id.toLowerCase())) return [{ id: team.owner.id, name: 'Owner' }]
  const one = team.members.find((m) => m.id.toLowerCase() === r || m.name.toLowerCase() === r)
  if (one) return [{ id: one.id, name: one.name }]
  return team.members.filter((m) => m.role.toLowerCase() === r || plural(m.role.toLowerCase()) === plural(r)).map((m) => ({ id: m.id, name: m.name }))
}

// a team person's thread id for any id it runs under: a teammate reopened from saved history runs under its Claude
// session id, not the tab id it joined with, and is still the same teammate (else its tools reject it, and Resume
// starts a second process on the same session)
const people = (team: Team): { id: string; sessionId?: string }[] => [team.lead, ...team.members, ...(team.owner ? [team.owner] : [])]
export const isPerson = (p: { id: string; sessionId?: string }, threadId: string) => p.id === threadId || (!!p.sessionId && p.sessionId === threadId)
export const personId = (team: Team, threadId: string): string => people(team).find((p) => isPerson(p, threadId))?.id ?? threadId

export const nameOf = (team: Team, threadId: string) => {
  const id = personId(team, threadId)
  return id === team.lead.id ? 'Lead' : id === team.owner?.id ? 'Owner' : team.members.find((m) => m.id === id)?.name ?? id
}

// the team a thread may act on: a member (or its lead) acts on its own team; an owner on the team it names
export const canAct = (team: Team, threadId: string) => people(team).some((p) => isPerson(p, threadId))

// end_team: the posts still queued that are now obsolete (for teammates and the Lead); what was queued for the Owner
// is kept, it is usually the Lead's final report
export const obsoleteQueued = <Q extends { to: string }>(team: Team, queued: Q[]): Q[] => queued.filter((q) => q.to !== team.owner?.id)

const roster = (team: Team) => [
  ...(team.owner ? [`- Owner (thread ${team.owner.id}): started the team; the Lead reports to it`] : []),
  `- Lead (thread ${team.lead.id}): plans, splits the work, settles disagreements, and reports ${team.owner ? 'to the Owner' : 'to the user'}`,
  ...team.members.map((m) => `- ${m.name} (${m.role}; thread ${m.id})`),
].join('\n')

const rules = (team: Team) => [
  `Shared folder: ${team.dir}`,
  '- plan.md: the plan and who owns which part; keep your own rows current (owner, state, notes) with Edit, and do not rewrite rows of others.',
  '- knowledge.md: facts the team learned (decisions, gotchas, paths, ids); add with mcp__hive__team_note, read it before you start.',
  '',
  'How the team works:',
  '- Talk to anyone directly with mcp__hive__team_post: a name, a role ("builders", "reviewers" reaches all of them), "Lead", or "all". Teammates work in parallel; you do not need the Lead to relay. Every post also lands on the team log the user watches. Keep posts short: what you did, what you need, what you found.',
  '- Discuss and decide among yourselves (e.g. builders agree on an interface, reviewers split the files); if you cannot agree, the Lead decides.',
  '- To-dos: keep your own list with mcp__hive__todo_add (for "me") as soon as you know your steps, mark items doing / done with mcp__hive__todo_update (with a short note: commit, result) the moment they are really done, and check the team board (todo_list "team") for the major to-dos you own. A major to-do is done only when its owner checks it off.',
  '- mcp__hive__team_status shows the state of each teammate and the recent log; check it before you assume what someone else is doing.',
  '- Ask the teammate who owns a thing instead of redoing it.',
  '- Do code work in your own worktree (mcp__hive__worktree) so you never edit the files of another teammate.',
  '- The user may message you directly; treat it like a message from the Lead, and tell the team (team_post) if it changes the plan.',
  '- Never push, merge or deploy, and never touch production; the Lead brings that to the user.',
]

// what a teammate's thread starts with
export function teamBrief(team: Team, me: Member, task: string): string {
  return [
    `You are "${me.name}" (${me.role}) on team "${team.name}", a group of Claude threads in the user's app working on one job together.`,
    `Team goal: ${team.goal}`,
    '',
    'The team:',
    roster(team),
    '',
    ...rules(team),
    '- When your part is done, post a short result to the Lead and stop until someone needs you.',
    '',
    `Your task: ${task}`,
  ].join('\n')
}

// what a Lead thread started by an Owner begins with
export function leadBrief(team: Team, task: string): string {
  return [
    `You are the Lead of team "${team.name}", a group of Claude threads in the user's app working on one job together. The Owner thread started the team and you report to it.`,
    `Team goal: ${team.goal}`,
    '',
    'The team so far:',
    roster(team),
    '',
    ...rules(team),
    '',
    'As Lead: put the major to-dos of the job on the team board first (mcp__hive__todo_add for "team", each with an owner), and write the plan into plan.md (rows: part, owner, state).'
    + ' The team cannot end while board items are open: chase owners to check them off or drop them with a note.',
    'Then: Add the teammates the job needs with mcp__hive__add_teammate',
    '(name, role, task; roles may repeat, e.g. several builders or reviewers; pick the fewest that cover the job). The role library is a starting point, not a limit: if the job needs another kind of teammate, write it with mcp__hive__define_role (it stays in the library for later teams). Let them work in parallel and talk directly.',
    'You get their posts as messages: wait for them instead of polling. When the job is done or blocked, post the result to the Owner',
    '(team_post to "Owner"), then end_team.',
    '',
    ...(task.trim() ? [`From the Owner: ${task}`] : []),
  ].join('\n')
}

// the reminder a thread gets back after it starts a team
export function startedNote(team: Team, selfIsLead: boolean): string {
  return [
    `Team "${team.name}" started (id ${team.id}), folder ${team.dir}.`,
    roster(team),
    selfIsLead
      ? 'You are the Lead: write the plan into plan.md now (rows: part, owner, state). Teammates post to you; wait for their posts instead of polling.'
      : `You are the Owner. The Lead runs the team and posts its result to you. Pass team "${team.id}" to team_post / team_status / add_teammate / end_team to act on it.`,
    'The user can watch the team, and message any member, in the Team view.',
  ].join('\n')
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const logLine = (e: LogEntry) => `${time(e.at)} ${e.fromName}${e.to.length ? ` -> ${e.to.join(', ')}` : ' (board)'}: ${e.text}`

export function formatTeamStatus(team: Team, states: Record<string, { state: MemberState; doing?: string }>, log: LogEntry[], last = 20): string {
  const row = (id: string, label: string) => {
    const s = states[id] ?? { state: 'closed' as MemberState }
    return `- ${label}: ${s.state}${s.doing ? `, ${s.doing}` : ''}`
  }
  return [
    `Team "${team.name}" (id ${team.id})${team.endedAt ? ' (ended)' : ''}: ${team.goal}`,
    `Folder: ${team.dir}`,
    'Members:',
    ...(team.owner ? [row(team.owner.id, 'Owner')] : []),
    row(team.lead.id, 'Lead'),
    ...team.members.map((m) => row(m.id, `${m.name} (${m.role})`)),
    log.length ? `Last ${Math.min(last, log.length)} posts:\n${log.slice(-last).map(logLine).join('\n')}` : 'No posts yet.',
  ].join('\n')
}

export const parseLog = (text: string): LogEntry[] => text.split('\n').filter((l) => l.trim()).flatMap((l) => {
  try { const e = JSON.parse(l); return typeof e?.text === 'string' ? [e as LogEntry] : [] } catch { return [] }
})
