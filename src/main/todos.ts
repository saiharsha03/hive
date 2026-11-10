// The user's personal to-do list, kept in ~/.hive/hive-todos.json. Claude can add items too.
import { randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { dataDir } from './testMode'

export type TodoStatus = 'todo' | 'talk' | 'holding' | 'done'
// `done` is kept in sync with status === 'done' so older readers of the file still work
export type Todo = {
  id: string; text: string; status: TodoStatus; done: boolean; due?: string
  createdAt: number; doneAt?: number; source?: 'user' | 'claude'
}
const STATUSES: TodoStatus[] = ['todo', 'talk', 'holding', 'done']
const DUE = /^\d{4}-\d{2}-\d{2}$/

// HIVE_TODOS_FILE points the store at another file (tests use a temp copy)
const todosFile = () => process.env.HIVE_TODOS_FILE || join(dataDir(), 'hive-todos.json')

// A missing file is an empty list; a file that exists but doesn't parse is an error,
// so a bad file is never overwritten.
async function read(): Promise<Todo[]> {
  const FILE = todosFile()
  let text: string
  try { text = await readFile(FILE, 'utf8') } catch (e: any) {
    if (e?.code === 'ENOENT') return []
    throw e
  }
  let list: any[]
  try { list = JSON.parse(text) } catch { throw new Error(`${FILE} is not valid JSON; fix it before changing the to-do list`) }
  if (!Array.isArray(list)) throw new Error(`${FILE} is not a list; fix it before changing the to-do list`)
  return list.map(upgrade)
}
// items from before statuses existed have only `done`
function upgrade(t: any): Todo {
  const status: TodoStatus = STATUSES.includes(t.status) ? t.status : t.done ? 'done' : 'todo'
  return { ...t, status, done: status === 'done' }
}
// temp file + rename, so a crash mid-write never leaves a half-written file
async function write(todos: Todo[]): Promise<void> {
  const FILE = todosFile()
  const tmp = `${FILE}.hive-tmp`
  await writeFile(tmp, JSON.stringify(todos, null, 2) + '\n')
  await rename(tmp, FILE)
}
// one change at a time, so two quick edits can't overwrite each other
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn)
  chain = run.catch(() => {})
  return run
}

export const listTodos = (): Promise<Todo[]> => serial(read)

const checkDue = (due?: string) => {
  if (due && !DUE.test(due)) throw new Error(`Due date must be YYYY-MM-DD, got "${due}"`)
}

export const addTodo = (text: string, source: 'user' | 'claude', opts: { due?: string; status?: TodoStatus } = {}): Promise<Todo> =>
  serial(async () => {
    checkDue(opts.due)
    const status = opts.status ?? 'todo'
    const todo: Todo = { id: randomUUID(), text: text.trim(), status, done: status === 'done', createdAt: Date.now(), source }
    if (opts.due) todo.due = opts.due
    if (status === 'done') todo.doneAt = Date.now()
    if (!todo.text) throw new Error('A to-do needs some text')
    await write([...(await read()), todo])
    return todo
  })

// change one item; an id that no longer exists (deleted elsewhere) is ignored
const change = (id: string, fn: (t: Todo) => void) =>
  serial(async () => {
    const todos = await read()
    const t = todos.find((x) => x.id === id)
    if (!t) return
    fn(t)
    await write(todos)
  })

export const setStatus = (id: string, status: TodoStatus) =>
  change(id, (t) => {
    if (!STATUSES.includes(status)) throw new Error(`Unknown status "${status}"`)
    const wasDone = t.status === 'done'
    t.status = status
    t.done = status === 'done'
    if (t.done && !wasDone) t.doneAt = Date.now()
    if (!t.done) delete t.doneAt
  })

// ticking the box marks done; unticking goes back to "To do"
export const setDone = (id: string, done: boolean) => setStatus(id, done ? 'done' : 'todo')

// an empty or missing date clears it
export const setDue = (id: string, due: string | null) =>
  change(id, (t) => {
    checkDue(due ?? undefined)
    if (due) t.due = due
    else delete t.due
  })

export const editTodo = (id: string, text: string) =>
  change(id, (t) => { if (text.trim()) t.text = text.trim() })

export const deleteTodo = (id: string) =>
  serial(async () => {
    const todos = await read()
    await write(todos.filter((t) => t.id !== id))
  })

// undo of a delete: put the item back where it was, unless it is already there again
export const restoreTodo = (todo: Todo, index: number) =>
  serial(async () => {
    const todos = await read()
    if (todos.some((t) => t.id === todo.id)) return
    todos.splice(Math.max(0, Math.min(index, todos.length)), 0, upgrade(todo))
    await write(todos)
  })

// calls onChange (debounced) when the file changes on disk: Hive, the agent's add_todo tool or the terminal helper.
// Watches the folder, since every write replaces the file by a rename. Returns a stop function.
export function watchTodos(onChange: () => void, delay = 150): () => void {
  const file = todosFile()
  const name = basename(file)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const w = watch(dirname(file), (_event, changed) => {
      if (changed && changed.toString() !== name) return
      clearTimeout(timer)
      timer = setTimeout(onChange, delay)
    })
    w.on('error', () => {})
    return () => { clearTimeout(timer); w.close() }
  } catch {
    return () => {}
  }
}
