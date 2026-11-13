// The user's personal to-do list as text for Claude (the list_todos tool): open items first, grouped by status, each
// with its due date and whether it is overdue. Pure, so it is tested.
export type ListedTodo = { id: string; text: string; status: 'todo' | 'talk' | 'holding' | 'done'; due?: string; createdAt: number; doneAt?: number }

const HEAD: Record<ListedTodo['status'], string> = { todo: 'To do', talk: 'Need to talk', holding: 'Holding', done: 'Done' }
const ORDER: ListedTodo['status'][] = ['todo', 'talk', 'holding', 'done']
// done items older than this are left out even when done ones are asked for: the list is for what matters now
export const DONE_KEPT_MS = 14 * 24 * 3_600_000

// today: YYYY-MM-DD in the user's own time zone, so "overdue" means what the To do page shows
export function formatTodos(todos: ListedTodo[], opts: { done?: boolean; now: number; today: string }): string {
  const open = todos.filter((t) => t.status !== 'done')
  const done = opts.done ? todos.filter((t) => t.status === 'done' && opts.now - (t.doneAt ?? t.createdAt) < DONE_KEPT_MS) : []
  if (!open.length && !done.length) return opts.done ? 'The to-do list is empty.' : 'No open to-dos.'
  const line = (t: ListedTodo) => {
    const due = !t.due ? '' : t.status !== 'done' && t.due < opts.today ? ` (due ${t.due}, overdue)` : t.due === opts.today && t.status !== 'done' ? ` (due ${t.due}, today)` : ` (due ${t.due})`
    return `- ${t.text.replace(/\s+/g, ' ').trim()}${due}`
  }
  // within a status: dated items first, soonest first, then the rest in the order they were added
  const byDue = (a: ListedTodo, b: ListedTodo) => (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : a.createdAt - b.createdAt)
  const out: string[] = []
  for (const s of ORDER) {
    const rows = [...open, ...done].filter((t) => t.status === s).sort(byDue)
    if (rows.length) out.push(`${HEAD[s]} (${rows.length}):`, ...rows.map(line), '')
  }
  const overdue = open.filter((t) => t.due && t.due < opts.today).length
  out.push(`${open.length} open${overdue ? `, ${overdue} overdue` : ''}${opts.done ? `, ${done.length} done in the last 14 days` : ''}.`)
  return out.join('\n')
}
