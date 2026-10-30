import { useEffect, useMemo, useState } from 'react'

const DAY = 86_400_000

// start date: time for today, otherwise "Oct 28", with the year only when it isn't this year
function started(t: number): string {
  const d = new Date(t)
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

function bucket(t: number): string {
  const today = new Date().setHours(0, 0, 0, 0)
  if (t >= today) return 'Today'
  if (t >= today - DAY) return 'Yesterday'
  if (t >= today - 7 * DAY) return 'This week'
  if (t >= today - 30 * DAY) return 'This month'
  return 'Older'
}

export function Sidebar({ activeId, onOpen }: { activeId: string | null; onOpen: (s: SessionInfo) => void }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => { window.api.listSessions().then(setSessions) }, [])

  const groups = useMemo(() => {
    const q = query.toLowerCase()
    const out: [string, SessionInfo[]][] = []
    for (const s of sessions ?? []) {
      if (q && !`${s.title} ${s.project}`.toLowerCase().includes(q)) continue
      const b = bucket(s.updated)
      if (out.at(-1)?.[0] !== b) out.push([b, []])
      out.at(-1)![1].push(s)
    }
    return out
  }, [sessions, query])

  return (
    <aside className="side">
      <div className="sidehead">
        <span>Sessions</span>
        <span className="count">{sessions ? sessions.length : ''}</span>
      </div>
      <input className="search" placeholder="Search sessions" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="slist">
        {!sessions && <div className="hint">Loading sessions…</div>}
        {groups.map(([label, items]) => (
          <div key={label}>
            <div className="group">{label}</div>
            {items.map((s) => (
              <button key={s.id} className={s.id === activeId ? 'srow active' : 'srow'} onClick={() => onOpen(s)} title={s.title}>
                <span className="t">{s.title}</span>
                <span className="p">
                  <span>{s.project}</span>
                  <span className="d">{started(s.started)}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
