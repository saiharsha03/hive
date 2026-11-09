// To-dos: the personal list in ~/.claude/hive-todos.json as a panel. Quick-add at the top (a trailing "fri", "tomorrow"
// or "11/05" becomes the due date), date groups, then Talk about, Holding and a folded Done. No dialogs: a delete
// can be undone for five seconds.
import { Icon } from './ui'
import { useEffect, useRef, useState } from 'react'
import { dueLabel, groupTodos, parseQuickAdd } from '../../shared/todoCore'

// onTalk: start a thread with Claude about this to-do
type Props = { todos: Todo[]; today: string; error: string; reload: () => void; onClose?: () => void; onTalk?: (t: Todo) => void }
const STATUSES: { s: TodoStatus; label: string }[] = [{ s: 'todo', label: 'To do' }, { s: 'talk', label: 'Talk' }, { s: 'holding', label: 'Hold' }]
const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// the native date picker, opened as soon as it shows; picking a day saves it, Escape or a click away closes it
function DatePick({ value, onPick, onClear, onCancel }: { value?: string; onPick: (d: string) => void; onClear: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); try { ref.current?.showPicker() } catch { /* needs a click in some cases */ } }, [])
  return (
    <>
      <input data-testid="todos-input-1"
        ref={ref} type="date" className="td-date" defaultValue={value ?? ''}
        onChange={(e) => { if (e.target.value) onPick(e.target.value) }}
        onBlur={onCancel} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
      />
      {value && <button data-testid="todos-button-2" className="td-due" onMouseDown={(e) => e.preventDefault()} onClick={onClear}>clear</button>}
    </>
  )
}

export function TodoPanel({ todos, today, error, reload, onClose, onTalk }: Props) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dating, setDating] = useState<string | null>(null)
  const [cur, setCur] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [undo, setUndo] = useState<{ todo: Todo; index: number } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [err, setErr] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const groups = groupTodos(todos, today)
  const visible = groups.flatMap((g) => (g.key === 'done' && !showDone ? [] : g.items))
  const open = todos.filter((t) => t.status === 'todo' || t.status === 'talk')
  const late = open.filter((t) => t.due && t.due < today).length
  const parsed = parseQuickAdd(text, today)

  const run = async (fn: () => Promise<unknown>) => {
    setErr('')
    try { await fn() } catch (e) { setErr(clean(e)) }
    reload()
  }
  const add = () => {
    if (!parsed.text) return
    setText('')
    void run(() => window.api.addTodo(parsed.text, parsed.due))
  }
  const startEdit = (t: Todo) => { editingRef.current = t.id; setEditing(t.id); setDraft(t.text) }
  const stopEdit = () => { editingRef.current = null; setEditing(null) }
  // Enter and a click away both save; the ref keeps the blur that follows Enter or Escape from saving twice
  const save = (t: Todo) => {
    if (editingRef.current !== t.id) return
    stopEdit()
    const v = draft.trim()
    if (v && v !== t.text) void run(() => window.api.editTodo(t.id, v))
  }
  const setDue = (id: string, due: string | null) => { setDating(null); void run(() => window.api.setTodoDue(id, due)) }
  const toggleDone = (t: Todo) => run(() => window.api.setTodoDone(t.id, t.status !== 'done'))
  const remove = (t: Todo) => {
    const i = visible.findIndex((x) => x.id === t.id)
    if (cur === t.id) setCur(visible[i + 1]?.id ?? visible[i - 1]?.id ?? null)
    clearTimeout(undoTimer.current)
    setUndo({ todo: t, index: todos.findIndex((x) => x.id === t.id) })
    undoTimer.current = setTimeout(() => setUndo(null), 5000)
    void run(() => window.api.deleteTodo(t.id))
  }
  const restore = () => {
    if (!undo) return
    clearTimeout(undoTimer.current)
    setUndo(null)
    void run(() => window.api.restoreTodo(undo.todo, undo.index))
  }

  // Up/Down move, Space ticks, Delete removes; typing in a box or a picker keeps its own keys
  const onKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement
    if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox')) return
    const i = visible.findIndex((t) => t.id === cur)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = visible[e.key === 'ArrowDown' ? Math.min(i + 1, visible.length - 1) : Math.max(i - 1, 0)]
      if (next) setCur(next.id)
      return
    }
    if (el !== e.currentTarget || i < 0) return
    if (e.key === ' ') { e.preventDefault(); void toggleDone(visible[i]) }
    if (e.key === 'Delete') { e.preventDefault(); remove(visible[i]) }
  }
  useEffect(() => { listRef.current?.querySelector('.td.cur')?.scrollIntoView({ block: 'nearest' }) }, [cur])

  const row = (t: Todo) => {
    const done = t.status === 'done'
    return (
      <div data-testid="todo-row" key={t.id} className={`td${done ? ' done' : ''}${cur === t.id ? ' cur' : ''}`} onMouseDown={() => setCur(t.id)}>
        <input data-testid="todo-done" type="checkbox" checked={done} onChange={() => void toggleDone(t)} aria-label={done ? 'Mark not done' : 'Mark done'} />
        {editing === t.id ? (
          <input data-testid="todos-input-3"
            className="search td-edit" value={draft} autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save(t)
              if (e.key === 'Escape') { e.stopPropagation(); stopEdit(); listRef.current?.focus() }
            }}
            onBlur={() => save(t)}
          />
        ) : (
          <span className="td-text" title="Click to edit" onClick={() => startEdit(t)}>{t.text}</span>
        )}
        {t.source === 'claude' && <span className="td-from">from Claude</span>}
        {dating === t.id ? (
          <DatePick value={t.due} onPick={(d) => setDue(t.id, d)} onClear={() => setDue(t.id, null)} onCancel={() => setDating(null)} />
        ) : (
          <button data-testid="todos-button-4" className={t.due ? (t.due < today && !done ? 'td-due late' : 'td-due') : 'td-due empty'} onClick={() => setDating(t.id)}>
            {t.due ? dueLabel(t.due, today) : 'add date'}
          </button>
        )}
        {!done && (
          <span className="td-seg" role="group" aria-label="Status">
            {STATUSES.map(({ s, label }) => (
              <button data-testid="todos-button-5" key={s} className={t.status === s ? 'on' : ''} onClick={() => t.status !== s && void run(() => window.api.setTodoStatus(t.id, s))}>{label}</button>
            ))}
          </span>
        )}
        {onTalk && !done && <button data-testid="todo-talk" className="td-x td-talk" onClick={() => onTalk(t)} aria-label="Talk to Claude about this" title="Talk to Claude about this"><Icon name="comment-discussion" /></button>}
        <button data-testid="todo-delete" className="td-x" onClick={() => remove(t)} aria-label="Delete" title="Delete">×</button>
      </div>
    )
  }

  return (
    <section data-testid="todos-panel" className="tool todos">
      <div className="dhead">
        <span className="dtitle"><span className="ph ph-todos">✓</span>To-dos</span>
        <span className="dnote">{open.length} open{late ? `, ${late} overdue` : ''}. Claude and the terminal helper can add here too.</span>
        <span className="dspace" />
        {onClose && <button className="dlink" aria-label="Close" onClick={onClose} data-testid="tool-close">×</button>}
      </div>
      <div className="dbody">
        <div className="td-add">
          <input data-testid="todo-add"
            className="search" placeholder="Add a to-do and press Enter (end with tomorrow, fri or 11/05 for a date)" value={text} autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
              if (e.key === 'ArrowDown' && visible.length) { e.preventDefault(); setCur(cur ?? visible[0].id); listRef.current?.focus() }
            }}
          />
          {parsed.due && <span className="td-hint">due {dueLabel(parsed.due, today)}</span>}
        </div>
        {(error || err) && <div className="derr">{err || error}</div>}
        {undo && (
          <div className="td-undo">
            <span>Deleted "{undo.todo.text}"</span>
            <button data-testid="todo-undo" className="dlink" onClick={restore}>Undo</button>
          </div>
        )}
        <div className="td-list" ref={listRef} tabIndex={0} onKeyDown={onKey}>
          {!open.length && <div className="dnote td-empty">Nothing open.</div>}
          {groups.map((g) => g.key === 'done' ? (
            <div key={g.key}>
              <button data-testid="todo-done-fold" className="tg td-fold" onClick={() => setShowDone((v) => !v)}>
                <span className="chev" style={{ transform: showDone ? 'rotate(90deg)' : undefined }}>›</span>Done <span className="tg-n">{g.items.length}</span>
              </button>
              {showDone && g.items.map(row)}
            </div>
          ) : (
            <div key={g.key}>
              <div className={`tg${g.key === 'overdue' ? ' late' : ''}`}>{g.label} <span className="tg-n">{g.items.length}</span></div>
              {g.items.map(row)}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
