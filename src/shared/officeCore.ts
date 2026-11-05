// The Team view's office scene, pure parts: who sits in the room and how each one looks (by role, with a distinct
// shirt per person so repeated roles still read apart), the plan board rows, the knowledge note, which log entries
// are new since the last poll (only those get animated), how desks split into floors, and the to-do lists.
import type { LogEntry, MemberState, TeamView } from './teamCore'
import type { Todo, TodoState } from './teamTodoCore'

export type Kind = 'lead' | 'builder' | 'reviewer' | 'validator' | 'qa' | 'plain'
export type Look = { kind: Kind; shirt: string; dark: string; skin: string; hair: string; legs: string; hat?: string }
// todo: done / total of the person's own list (dropped items left out), '' when the list is empty
export type Person = { id: string; name: string; role: string; state: MemberState; doing?: string; look: Look; todo: string }
// mark: a to-do row on the team board (drawn as a checkbox)
export type BoardRow = { part: string; owner: string; state: string; known: boolean; mark?: TodoState }

export const STATE_WORD: Record<MemberState, string> = { working: 'WORKING', waiting: 'WAITING', idle: 'IDLE', closed: 'OFF' }

export function kindOf(role: string): Kind {
  const r = role.toLowerCase()
  if (/\blead\b|orchestrat/.test(r)) return 'lead'
  if (/\bqa\b|quality/.test(r)) return 'qa'
  if (/review/.test(r)) return 'reviewer'
  if (/valid|test|verif/.test(r)) return 'validator'
  if (/build|dev|engineer|coder|implement|program/.test(r)) return 'builder'
  return 'plain'
}

// no purple, lilac or indigo; one shirt per member, in join order, so two builders never match
const SHIRTS = ['#d9772b', '#2a8c82', '#9c4436', '#4f6f8f', '#5e8c3a', '#b8892b', '#2f6fa8', '#a65a2e', '#6b7d3c', '#c4544a', '#2f6b5c', '#7a5c3e']
const SKIN = ['#e1b48f', '#8a5a3c', '#d29a70', '#f0caa6', '#6b4528', '#d8a57c', '#a86f4c']
const HAIR = ['#2a1f17', '#5b3a1f', '#1f1712', '#b9b3a8', '#8a5a2b', '#3a2a20', '#151515']
const LEGS = ['#26262b', '#34404d', '#2f2a26', '#2a2a2e', '#23262b']
const HATS = ['#e9a81c', '#ececec', '#3d8fd6']

const darken = (hex: string, k = 0.74) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('')

// i: the member's place in the room (0 = Lead); builders: how many builders came before this one
export function lookOf(role: string, i: number, builders = 0): Look {
  const kind = i === 0 ? 'lead' : kindOf(role)
  const shirt = i === 0 ? '#3e4c5e' : SHIRTS[(i - 1) % SHIRTS.length]
  return {
    kind, shirt, dark: darken(shirt),
    skin: SKIN[(i * 3) % SKIN.length], hair: HAIR[(i * 2 + 1) % HAIR.length], legs: LEGS[i % LEGS.length],
    ...(kind === 'builder' ? { hat: HATS[builders % HATS.length] } : {}),
  }
}

// Lead first, then members in join order; the Owner is not in the room
export function peopleOf(v: TeamView): Person[] {
  const st = (id: string) => v.states[id] ?? { state: 'closed' as MemberState }
  const members = v.team.members.map((m, k) => ({ m, k })).sort((a, b) => a.m.joinedAt - b.m.joinedAt || a.k - b.k).map((x) => x.m)
  let builders = 0
  const todo = (id: string) => todoCount((v.todos ?? []).filter((t) => !t.major && t.owner === id))
  return [
    { id: v.team.lead.id, name: 'Lead', role: 'lead', state: st(v.team.lead.id).state, doing: st(v.team.lead.id).doing, look: lookOf('lead', 0), todo: todo(v.team.lead.id) },
    ...members.map((m, k) => {
      const look = lookOf(m.role, k + 1, builders)
      if (look.kind === 'builder') builders++
      return { id: m.id, name: m.name, role: m.role, state: st(m.id).state, doing: st(m.id).doing, look, todo: todo(m.id) }
    }),
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

// the last two things the team learned, without the "(who, when)" stamp team_note adds
export const knowledgeNote = (md: string): string[] =>
  md.split('\n').filter((l) => /^\s*[-*+]\s+\S/.test(l))
    .map((l) => l.replace(/^\s*[-*+]\s+/, '').replace(/\s*\([^()]*,\s*\d{4}-\d\d-\d\d[ T]\d\d:\d\d\)\s*$/, '').trim())
    .filter(Boolean).slice(-2)

export function bubbleText(text: string, max = 70): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t
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

// never fall far behind: past `max` waiting messages, keep only the latest `keep`
export const trimQueue = <T>(q: T[], max = 4, keep = 2): T[] => (q.length > max ? q.slice(-keep) : q)

// desks per floor in the side view: at most `per` a floor, floors balanced (7 -> 4 + 3, 11 -> 6 + 5)
export function floorsOf(n: number, per = 6): number[][] {
  const f = Math.max(1, Math.ceil(n / per)), size = Math.ceil(n / f)
  return Array.from({ length: f }, (_, k) => Array.from({ length: Math.max(0, Math.min(size, n - k * size)) }, (_, j) => k * size + j))
}

// which board rows show when only `fit` lines fit: the last line becomes "+N more" when rows are cut
export function boardFit(total: number, fit: number): { shown: number; more: number } {
  const f = Math.max(1, fit)
  return total <= f ? { shown: total, more: 0 } : { shown: f - 1, more: total - (f - 1) }
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

// what the office whiteboard shows: the team board of major to-dos when there are any, else the plan.md rows
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
