// Row menu for a session in the sidebar: pin, snooze, close, archive. Closes on an outside click or Escape.
import { useEffect, useRef, useState } from 'react'
import { PRESETS, archive, clearSnooze, close, pin, presetTime, snooze, type ThreadMap } from './threads'
import { flagActions } from './selection'
import { useEscape, useMenuKeys } from './ui'

// ids: the threads the menu acts on (one row, or the whole selection); onDone runs after an action
type Props = { ids: string[]; states: ThreadMap; x: number; y: number; onClose: () => void; onDone: () => void }

// value for a datetime-local input: local time, no seconds
const local = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}

export function ThreadMenu({ ids, states, x, y, onClose, onDone }: Props) {
  const many = ids.length > 1
  const of = (label: string) => (many ? `${label} ${ids.length} threads` : label)
  const each = (fn: (id: string) => void) => ids.forEach(fn)
  const [snoozing, setSnoozing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [when, setWhen] = useState(() => local(Date.now() + 3_600_000))
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // keep the menu inside the window, including after the snooze list opens
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ left: Math.max(4, Math.min(x, innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, innerHeight - r.height - 4)) })
  }, [x, y, snoozing, picking])

  const shut = useRef(onClose)
  shut.current = onClose
  useEscape(() => shut.current())
  const keys = useMenuKeys(ref)
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) shut.current() }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [])

  const act = (fn: () => void) => () => { fn(); onDone(); onClose() }
  const setPick = () => {
    const t = new Date(when).getTime()
    if (Number.isFinite(t)) { each((id) => snooze(id, t)); onDone(); onClose() }
  }

  return (
    <div data-testid="thread-menu" className="tmenu" role="menu" ref={ref} style={pos} onKeyDown={keys} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {flagActions(states, ids, 'pinned').map((a) => <button data-testid="threadmenu-button-1" key={a.label} onClick={act(() => each((id) => pin(id, a.on)))}>{of(a.label)}</button>)}
      <button data-testid="threadmenu-button-2" onClick={() => setSnoozing(!snoozing)}>{of('Snooze')}<span className="chev" style={{ transform: snoozing ? 'rotate(90deg)' : undefined }}>›</span></button>
      {snoozing && (
        <div className="tsub">
          {PRESETS.map((p) => <button data-testid="threadmenu-button-3" key={p.id} onClick={act(() => { const t = presetTime(p.id, Date.now()); each((id) => snooze(id, t)) })}>{p.label}</button>)}
          {picking ? (
            <div className="tpick">
              <input data-testid="threadmenu-input-4" type="datetime-local" value={when} min={local(Date.now())} autoFocus onChange={(e) => setWhen(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setPick() }} />
              <button data-testid="threadmenu-button-5" onClick={setPick}>Set</button>
            </div>
          ) : <button data-testid="threadmenu-button-6" onClick={() => setPicking(true)}>Pick a time…</button>}
        </div>
      )}
      {ids.some((id) => (states[id]?.snoozedUntil ?? 0) > Date.now()) && <button data-testid="threadmenu-button-7" onClick={act(() => each(clearSnooze))}>{of('Cancel snooze')}</button>}
      {flagActions(states, ids, 'closedAt').map((a) => <button data-testid="threadmenu-button-8" key={a.label} onClick={act(() => each((id) => close(id, a.on)))}>{of(a.label)}</button>)}
      {flagActions(states, ids, 'archivedAt').map((a) => <button data-testid="threadmenu-button-9" key={a.label} onClick={act(() => each((id) => archive(id, a.on)))}>{of(a.label)}</button>)}
    </div>
  )
}
