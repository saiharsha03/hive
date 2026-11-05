// Team to-dos: one team board of major to-dos (the job's milestones, each with an owner) and a personal list per
// teammate. Everyone adds what they will do, marks it doing, and checks it off when it is really done. The team
// cannot end while major to-dos are open. Pure: the list is kept in todos.json by main/teams.ts.

export type TodoState = 'open' | 'doing' | 'done' | 'dropped'
export type Todo = {
  id: string // T1, T2, ... unique in the team
  text: string
  major: boolean // on the team board
  owner: string // thread id of who does it ('' = unassigned team item)
  state: TodoState
  by: string // thread id that added it
  at: number
  doneAt?: number
  note?: string // why dropped, what was done, a PR / commit
}

export const nextId = (todos: Todo[]) => `T${todos.reduce((n, t) => Math.max(n, Number(t.id.slice(1)) || 0), 0) + 1}`

export function addTodo(todos: Todo[], t: Omit<Todo, 'id' | 'state'>): Todo[] {
  return [...todos, { ...t, id: nextId(todos), state: 'open', text: t.text.trim() }]
}

// change one to-do; only its owner, whoever added it, or the lead may (an unassigned team item: anyone)
export function updateTodo(todos: Todo[], id: string, by: string, lead: string, patch: { state?: TodoState; note?: string; owner?: string; text?: string }, now: number): Todo[] | string {
  const t = todos.find((x) => x.id.toLowerCase() === id.trim().toLowerCase())
  if (!t) return `No to-do ${id}.`
  if (t.owner && t.owner !== by && t.by !== by && by !== lead) return `${t.id} belongs to someone else; ask them (team_post) or the Lead.`
  return todos.map((x) => x !== t ? x : {
    ...x,
    ...(patch.text ? { text: patch.text.trim() } : {}),
    ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
    ...(patch.note ? { note: patch.note.trim() } : {}),
    ...(patch.state ? { state: patch.state, ...(patch.state === 'done' || patch.state === 'dropped' ? { doneAt: now } : { doneAt: undefined }) } : {}),
  })
}

export const openOf = (todos: Todo[]) => todos.filter((t) => t.state === 'open' || t.state === 'doing')
export const openMajor = (todos: Todo[]) => openOf(todos).filter((t) => t.major)

const MARK: Record<TodoState, string> = { open: '[ ]', doing: '[~]', done: '[x]', dropped: '[-]' }
const line = (t: Todo, name: (id: string) => string) =>
  `${MARK[t.state]} ${t.id} ${t.text}${t.major ? ` (owner: ${t.owner ? name(t.owner) : 'unassigned'})` : ''}${t.note ? ` - ${t.note}` : ''}`

// the board and personal lists as text, for todo_list and team_status
export function formatTodos(todos: Todo[], name: (id: string) => string, only?: { major?: boolean; owner?: string }): string {
  const pick = todos.filter((t) => (only?.major === undefined || t.major === only.major) && (only?.owner === undefined || t.owner === only.owner))
  const major = pick.filter((t) => t.major)
  const mine = pick.filter((t) => !t.major)
  const out: string[] = []
  if (only?.major !== false) out.push(major.length ? `Team board (${openOf(major).length} open of ${major.length}):\n${major.map((t) => line(t, name)).join('\n')}` : 'Team board: empty.')
  if (only?.major !== true) {
    const owners = [...new Set(mine.map((t) => t.owner))]
    out.push(owners.length
      ? owners.map((o) => `${name(o)} (${openOf(mine.filter((t) => t.owner === o)).length} open):\n${mine.filter((t) => t.owner === o).map((t) => line(t, name)).join('\n')}`).join('\n')
      : 'No personal to-dos.')
  }
  return out.join('\n\n')
}

export const parseTodos = (text: string): Todo[] => {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v.filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string') : [] } catch { return [] }
}
