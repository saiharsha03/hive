// The to-do list for the app: loaded once, reloaded whenever main says the file changed (or Claude added an item).
// `today` moves on at midnight so the groups and the badge stay right in a window left open overnight.
import { useEffect, useState } from 'react'
import { iso } from '../../shared/todoCore'

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [error, setError] = useState('')
  const [today, setToday] = useState(() => iso(new Date()))
  const reload = () => window.api.listTodos().then((l) => { setTodos(l); setError('') }).catch((e) => setError(String(e?.message ?? e)))
  useEffect(() => {
    reload()
    const offFile = window.api.onTodosChanged(reload)
    const offChat = window.api.onChatEvent((_tab, ev) => { if (ev.type === 'hive_todos_changed') reload() })
    const t = setInterval(() => setToday(iso(new Date())), 60_000)
    return () => { offFile(); offChat(); clearInterval(t) }
  }, [])
  return { todos, error, today, reload }
}
