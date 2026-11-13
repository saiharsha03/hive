// The Team view's pure parts (named for the office scene it once drew): who is on the team and in what state, the
// plan board rows, which log entries are new since a mark, the chat with one member, and the to-do lists.
import type { LogEntry, MemberState, TeamView } from './teamCore'
import type { Todo, TodoState } from './teamTodoCore'

// todo: done / total of the person's own list (dropped items left out), '' when the list is empty
export type Person = { id: string; name: string; role: string; state: MemberState; doing?: string; todo: string }
// mark: a to-do row on the team board (drawn as a checkbox)
export type BoardRow = { part: string; owner: string; state: string; known: boolean; mark?: TodoState }

export const STATE_WORD: Record<MemberState, string> = { working: 'WORKING', waiting: 'WAITING', idle: 'IDLE', closed: 'OFF' }

// Lead first, then members in join order; the Owner is not on the roster
export function peopleOf(v: TeamView): Person[] {
  const st = (id: string) => v.states[id] ?? { state: 'closed' as MemberState }
  const members = v.team.members.map((m, k) => ({ m, k })).sort((a, b) => a.m.joinedAt - b.m.joinedAt || a.k - b.k).map((x) => x.m)
  const todo = (id: string) => todoCount((v.todos ?? []).filter((t) => !t.major && t.owner === id))
  return [
    { id: v.team.lead.id, name: 'Lead', role: 'lead', state: st(v.team.lead.id).state, doing: st(v.team.lead.id).doing, todo: todo(v.team.lead.id) },
    ...members.map((m) => ({ id: m.id, name: m.name, role: m.role, state: st(m.id).state, doing: st(m.id).doing, todo: todo(m.id) })),
  ]
}

const KNOWN = new Set(['working', 'waiting', 'idle', 'off', 'done', 'failed', 'blocked'])
const clean = (s: string) => s.replace(/\*\*|__|`/g, '').trim()

// rows of the plan's markdown tables (| Part | Owner | State | Notes |); the first row of a table is its header
export function parsePlan(md: string): BoardRow[] {
  const rows: BoardRow[] = []
  let cols: { part: number; owner: number; state: number } | null = null
  for (const line of md.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('|')) { cols = null; continue }
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(clean)
    if (cells.every((c) => !c || /^:?-+:?$/.test(c))) continue
    if (!cols) {
      const h = cells.map((c) => c.toLowerCase())
      const at = (re: RegExp, d: number) => { const i = h.findIndex((c) => re.test(c)); return i >= 0 ? i : d }
      cols = { part: at(/part|task|item|work/, 0), owner: at(/owner|who/, 1), state: at(/state|status/, 2) }
      continue
    }
    const part = cells[cols.part] ?? ''
    if (!part) continue
    const raw = cells[cols.state] ?? ''
    const known = KNOWN.has(raw.toLowerCase())
    rows.push({ part, owner: cells[cols.owner] ?? '', state: known ? raw.toUpperCase() : raw, known })
  }
  return rows
}

// the newest time seen and how many entries carry it; the log is append-only but the view sends only its tail
export type LogMark = { at: number; n: number }
export function markOf(log: LogEntry[]): LogMark {
  const at = log.length ? log[log.length - 1].at : 0
  return { at, n: log.filter((e) => e.at === at).length }
}
export function newSince(mark: LogMark, log: LogEntry[]): LogEntry[] {
  let same = 0
  return log.filter((e) => e.at > mark.at || (e.at === mark.at && ++same > mark.n))
}

// the recent exchange with one member for the chat panel: their posts, posts to them, what the user sent them
// from the panel, and their latest final reply; oldest first so the newest sits at the bottom
export type ChatLine = { at: number; kind: 'them' | 'to' | 'you' | 'reply'; head: string; text: string }
export function chatOf(v: TeamView, id: string, sent: { at: number; text: string }[] = [], last = 14): ChatLine[] {
  const name = id === v.team.lead.id ? 'Lead' : v.team.members.find((m) => m.id === id)?.name ?? id
  const n = name.toLowerCase()
  const lines: ChatLine[] = []
  for (const e of v.log) {
    if (e.from === id) lines.push({ at: e.at, kind: 'them', head: e.to.length ? `to ${e.to.join(', ')}` : 'to the board', text: e.text })
    else if (e.to.some((t) => t.toLowerCase() === n || t === id)) lines.push({ at: e.at, kind: 'to', head: `${e.fromName} to ${name}`, text: e.text })
  }
  for (const m of sent) lines.push({ at: m.at, kind: 'you', head: 'You', text: m.text })
  const st = v.states[id]
  if (st?.reply) lines.push({ at: st.at ?? Number.MAX_SAFE_INTEGER, kind: 'reply', head: 'Last reply', text: st.reply })
  return lines.map((l, k) => ({ l, k })).sort((a, b) => a.l.at - b.l.at || a.k - b.k).map((x) => x.l).slice(-last)
}

// to-dos: active ones first (doing, open), then done, then dropped; otherwise in the order they were added
const RANK: Record<TodoState, number> = { doing: 0, open: 1, done: 2, dropped: 3 }
export const sortTodos = (todos: Todo[]) => todos.map((t, k) => ({ t, k })).sort((a, b) => RANK[a.t.state] - RANK[b.t.state] || a.k - b.k).map((x) => x.t)
export function todoCount(todos: Todo[]): string {
  const live = todos.filter((t) => t.state !== 'dropped')
  return live.length ? `${live.filter((t) => t.state === 'done').length}/${live.length}` : ''
}
export const nameIn = (v: TeamView, id: string) =>
  !id ? 'unassigned' : id === v.team.lead.id ? 'Lead' : id === v.team.owner?.id ? 'Owner' : v.team.members.find((m) => m.id === id)?.name ?? id

// the team board: the team board of major to-dos when there are any, else the plan.md rows
export function boardOf(v: TeamView): { title: string; count: string; rows: BoardRow[] } {
  const major = sortTodos((v.todos ?? []).filter((t) => t.major))
  if (!major.length) return { title: 'Plan', count: '', rows: parsePlan(v.plan) }
  const live = major.filter((t) => t.state !== 'dropped')
  return {
    title: 'Team board',
    count: `${live.filter((t) => t.state === 'done').length} of ${live.length} done`,
    rows: major.map((t) => ({ part: t.text, owner: nameIn(v, t.owner), state: t.state.toUpperCase(), known: true, mark: t.state })),
  }
}
