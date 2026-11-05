// Team threads: a lead thread starts several real threads (teammates) that work on one job together. They share a
// folder (team.json, plan.md, knowledge.md, log.jsonl) and talk through team_post. Pure parts here: the shapes,
// the brief each teammate starts with, the log and status text. Files and threads live in main/teams.ts.

export const MAX_TEAMMATES = 6

export type Member = { id: string; name: string; role: string; cwd: string; joinedAt: number }
export type Team = { id: string; name: string; goal: string; dir: string; lead: { id: string; title: string }; members: Member[]; createdAt: number; endedAt?: number }
export type LogEntry = { at: number; from: string; fromName: string; to: string[]; text: string } // to [] = posted to the board only
export type MemberState = 'working' | 'waiting' | 'idle' | 'closed'
export type TeamView = { team: Team; states: Record<string, { state: MemberState; doing?: string }>; log: LogEntry[]; plan: string; knowledge: string }

// short, unique, readable id part: "Builder helix-api" -> "builder-helix-api"
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'mate'

// a name everyone in the team can address: the member's name, its role, or its thread id, case-insensitive
export function findMember(team: Team, ref: string): { id: string; name: string } | null {
  const r = ref.trim().toLowerCase()
  if (r === 'lead' || r === team.lead.id.toLowerCase() || r === team.lead.title.toLowerCase()) return { id: team.lead.id, name: 'Lead' }
  const m = team.members.find((x) => x.id.toLowerCase() === r || x.name.toLowerCase() === r)
    ?? (team.members.filter((x) => x.role.toLowerCase() === r).length === 1 ? team.members.find((x) => x.role.toLowerCase() === r) : undefined)
  return m ? { id: m.id, name: m.name } : null
}

export const nameOf = (team: Team, id: string) => (id === team.lead.id ? 'Lead' : team.members.find((m) => m.id === id)?.name ?? id)

const roster = (team: Team) => [
  `- Lead (thread ${team.lead.id}): plans, splits the work, decides, and reports to the user`,
  ...team.members.map((m) => `- ${m.name} (${m.role}; thread ${m.id})`),
].join('\n')

// what a teammate's thread starts with, before its task
export function teamBrief(team: Team, me: Member, task: string): string {
  return [
    `You are "${me.name}" (${me.role}) on team "${team.name}", a group of Claude threads in the user's app working on one job together.`,
    `Team goal: ${team.goal}`,
    '',
    'The team:',
    roster(team),
    '',
    `Shared folder: ${team.dir}`,
    '- plan.md: the plan and who owns which part; keep your own rows current (owner, state, notes) with Edit, and do not rewrite other rows.',
    '- knowledge.md: facts the team learned (decisions, gotchas, paths, ids); add with mcp__hive__team_note, read it before you start.',
    '',
    'How the team works:',
    '- mcp__hive__team_post talks to teammates by name or role (or "all"); every post also lands on the team log the user watches. Keep posts short: what you did, what you need, what you found.',
    '- mcp__hive__team_status shows each teammate\'s state and the recent log; check it before you assume what someone else is doing.',
    '- Ask the teammate who owns a thing instead of redoing it. If two of you disagree, the Lead decides.',
    '- Do code work in your own worktree (mcp__hive__worktree) so you never edit another teammate\'s files.',
    '- Never push, merge or deploy, and never touch production; the Lead brings that to the user.',
    '- When your part is done, post a short result to the Lead and stop.',
    '',
    `Your task: ${task}`,
  ].join('\n')
}

// the lead's own reminder after it starts the team
export function leadNote(team: Team): string {
  return [
    `Team "${team.name}" started (id ${team.id}), folder ${team.dir}.`,
    roster(team),
    'Write the plan into plan.md now (rows: part, owner, state). Teammates report to you with team_post; use team_status to see who works on what.',
    'Wait for posts instead of polling: you get them as messages. The user can watch the team in the Team view.',
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
    `Team "${team.name}"${team.endedAt ? ' (ended)' : ''}: ${team.goal}`,
    `Folder: ${team.dir}`,
    'Members:',
    row(team.lead.id, 'Lead'),
    ...team.members.map((m) => row(m.id, `${m.name} (${m.role})`)),
    log.length ? `Last ${Math.min(last, log.length)} posts:\n${log.slice(-last).map(logLine).join('\n')}` : 'No posts yet.',
  ].join('\n')
}

export const parseLog = (text: string): LogEntry[] => text.split('\n').filter((l) => l.trim()).flatMap((l) => {
  try { const e = JSON.parse(l); return typeof e?.text === 'string' ? [e as LogEntry] : [] } catch { return [] }
})
