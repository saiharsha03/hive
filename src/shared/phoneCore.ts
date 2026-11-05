// What the phone app's Teams, background-work and Wake-ups screens show, shaped from the desktop's own state. Pure, so
// it can be tested without Electron; the relay ops in mobile.ts send these as they are.
import type { LogEntry, MemberStatus, Team } from './teamCore'
import { kindLabel, type Task } from './taskCore'

export type PhoneMember = { id: string; open: string; name: string; role: string; state: string }
export type PhoneTeam = { id: string; name: string; goal: string; word: 'WORKING' | 'IDLE' | 'PAUSED'; members: PhoneMember[]; posts: { from: string; text: string; at: number }[] }

// running teams, newest first; open = the id the phone's thread request takes (the live tab when the thread runs, else
// its Claude session); the last few posts of the team log
export function phoneTeams(teams: Team[], view: (t: Team) => { states: Record<string, MemberStatus>; log: LogEntry[]; liveId: (id: string) => string | null }, posts = 5): PhoneTeam[] {
  return teams.filter((t) => !t.endedAt).sort((a, b) => b.createdAt - a.createdAt).map((t) => {
    const v = view(t)
    const people = [{ id: t.lead.id, name: 'Lead', role: 'lead', sessionId: t.lead.sessionId }, ...t.members]
    const members = people.map((p) => ({
      id: p.id, open: v.liveId(p.id) ?? p.sessionId ?? p.id, name: p.name, role: p.role, state: v.states[p.id]?.state ?? 'closed',
    }))
    const word = t.pausedAt ? 'PAUSED' : members.some((m) => m.state === 'working') ? 'WORKING' : 'IDLE'
    return { id: t.id, name: t.name, goal: t.goal, word, members, posts: v.log.slice(-posts).map((e) => ({ from: e.fromName, text: e.text.slice(0, 500), at: e.at })) }
  })
}

// a thread's running background work with its live line
export const phoneTasks = (tasks: Task[]): { id: string; kind: string; title: string; now: string }[] =>
  tasks.filter((t) => t.status === 'running').map((t) => ({ id: t.id, kind: kindLabel(t.kind), title: t.name ? `${t.name}: ${t.title}` : t.title, now: t.now ?? '' }))

export type PhoneWakeup = { kind: 'wake' | 'continue'; id: string; open: string; title: string; at: number; prompt: string; every: number | null }
type WakeRow = { id: number; session_id: string; title: string; wake_at: string; prompt: string; every_minutes: number | null; status: string }

// every scheduled wake-up, soonest first: a thread's own (schedule_wakeup) and the usage-limit auto-continues
export function phoneWakeups(rows: WakeRow[], continues: { key: string; title: string; at: number }[]): PhoneWakeup[] {
  const own = rows.filter((r) => r.status === 'pending').map((r) => ({
    kind: 'wake' as const, id: String(r.id), open: r.session_id, title: r.title || 'Thread', at: Date.parse(r.wake_at), prompt: r.prompt.slice(0, 300), every: r.every_minutes,
  }))
  const cont = continues.map((c) => ({ kind: 'continue' as const, id: c.key, open: c.key, title: c.title, at: c.at, prompt: 'Continue after the usage limit resets', every: null }))
  return [...own, ...cont].filter((w) => Number.isFinite(w.at)).sort((a, b) => a.at - b.at)
}
