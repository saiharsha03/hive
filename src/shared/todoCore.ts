// Pure helpers for the To-dos panel: dates as local YYYY-MM-DD strings, the quick-add date phrase, and the groups.

export type TodoStatus = 'todo' | 'talk' | 'holding' | 'done'
export type TodoItem = { id: string; text: string; status: TodoStatus; due?: string; createdAt: number; doneAt?: number }

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (s: string, n: number) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d) }

const DAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
}

// one date word or M/D[/YY[YY]] -> YYYY-MM-DD, or null. A weekday is the next one after today (on a Friday, "fri" is
// a week out); a M/D without a year that has already passed this year is next year's.
function phraseDate(word: string, today: string): string | null {
  const w = word.toLowerCase()
  if (w === 'today') return today
  if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') return addDays(today, 1)
  if (w in DAYS) {
    const ahead = (DAYS[w] - fromIso(today).getDay() + 7) % 7 || 7
    return addDays(today, ahead)
  }
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(w)
  if (!m) return null
  const month = Number(m[1]), day = Number(m[2])
  const valid = (y: number) => { const d = new Date(y, month - 1, day); return d.getMonth() === month - 1 && d.getDate() === day ? iso(d) : null }
  if (m[3]) return valid(Number(m[3].length === 2 ? `20${m[3]}` : m[3]))
  // no year: the first time it comes round from today on (Feb 29 can be up to four years out)
  const year = fromIso(today).getFullYear()
  for (let y = year; y <= year + 4; y++) { const d = valid(y); if (d && d >= today) return d }
  return null
}

// "call the vendor fri" -> { text: 'call the vendor', due: <next Friday> }. Only the last word counts, optionally
// after "by", "due" or "on"; text that would be left empty keeps the phrase as the item.
export function parseQuickAdd(input: string, today: string): { text: string; due?: string } {
  const text = input.trim().replace(/\s+/g, ' ')
  const m = /^(.*\S)\s+(\S+)$/.exec(text)
  const due = m ? phraseDate(m[2], today) : null
  const rest = m ? m[1].replace(/(^|\s)(by|due|on)$/i, '').trim() : ''
  return due && rest ? { text: rest, due } : { text }
}

export type GroupKey = 'overdue' | 'today' | 'week' | 'later' | 'talk' | 'holding' | 'done'
export type Group<T> = { key: GroupKey; label: string; items: T[] }
const LABELS: Record<GroupKey, string> = {
  overdue: 'Overdue', today: 'Due today', week: 'This week', later: 'Later / no date', talk: 'Talk about', holding: 'Holding', done: 'Done',
}

// soonest due first; items without a date after the dated ones, newest first
const byDue = (a: TodoItem, b: TodoItem) =>
  a.due && b.due ? (a.due < b.due ? -1 : a.due > b.due ? 1 : b.createdAt - a.createdAt) : a.due ? -1 : b.due ? 1 : b.createdAt - a.createdAt

// "To do" items split by due date ("This week" = the next six days); talk, holding and done are their own groups.
// Empty groups are left out; the order of the result is the order on screen.
export function groupTodos<T extends TodoItem>(todos: T[], today: string): Group<T>[] {
  const week = addDays(today, 6)
  const key = (t: T): GroupKey => {
    if (t.status !== 'todo') return t.status
    if (!t.due) return 'later'
    return t.due < today ? 'overdue' : t.due === today ? 'today' : t.due <= week ? 'week' : 'later'
  }
  const order: GroupKey[] = ['overdue', 'today', 'week', 'later', 'talk', 'holding', 'done']
  return order
    .map((k) => {
      const items = todos.filter((t) => key(t) === k)
      items.sort(k === 'done' ? (a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0) : byDue)
      return { key: k, label: LABELS[k], items }
    })
    .filter((g) => g.items.length)
}

// the top-bar badge: open = to do + talk about; late = any open item past its date
export function todoBadge(todos: TodoItem[], today: string): { open: number; late: boolean } {
  const open = todos.filter((t) => t.status === 'todo' || t.status === 'talk')
  return { open: open.length, late: open.some((t) => !!t.due && t.due < today) }
}

// "Today", "Tomorrow", "Yesterday", a weekday within the next week, otherwise "Nov 4" (with the year if not this one)
export function dueLabel(due: string, today: string): string {
  const days = Math.round((fromIso(due).getTime() - fromIso(today).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  const d = fromIso(due)
  if (days > 1 && days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  const sameYear = d.getFullYear() === fromIso(today).getFullYear()
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}
