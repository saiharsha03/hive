// Ctrl+K: one box for threads (live and saved), files, tools, actions, UI and theme. Type to filter, Up / Down, Enter.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './ui'
import { matchRank } from '../../shared/paletteRank'

export type Command = { id: string; group: string; label: string; hint?: string; icon: string; mk?: string; run: () => void }

export function CommandPalette({ commands, onClose, loadThreads, loadFiles }: { commands: Command[]; onClose: () => void; loadThreads: () => Promise<Command[]>; loadFiles: (q: string) => Promise<Command[]> }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [saved, setSaved] = useState<Command[]>([])
  const [files, setFiles] = useState<Command[]>([])
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { void loadThreads().then(setSaved).catch(() => {}) }, [])
  // files under the folder, from 2 characters on; a late answer for an older text is dropped
  useEffect(() => {
    let alive = true
    if (q.trim().length < 2) { setFiles([]); return }
    void loadFiles(q.trim()).then((f) => { if (alive) setFiles(f) }).catch(() => { if (alive) setFiles([]) })
    return () => { alive = false }
  }, [q])
  // Escape closes it wherever the focus is
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  const all = useMemo(() => [...commands, ...saved.filter((s) => !commands.some((c) => c.id === s.id))], [commands, saved])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = all.filter((c) => { const t = `${c.group} ${c.label} ${c.hint ?? ''}`.toLowerCase(); return words.every((w) => t.includes(w)) })
    if (!words.length) return hit
    // best match first inside each group (label starts with it, then a word of it, then anywhere); groups keep their order
    const groups = [...new Set(hit.map((c) => c.group))]
    const rank = (c: Command) => matchRank(c.label, q) ?? 3
    const sorted = groups.flatMap((g) => hit.filter((c) => c.group === g).sort((a, b) => rank(a) - rank(b)))
    return [...sorted, ...files] // files arrive already ranked
  }, [all, q, files])
  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { list.current?.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])
  const run = (c?: Command) => { if (!c) return; onClose(); c.run() }
  let lastGroup = ''
  return (
    <div className="scrim top" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-testid="palette-scrim">
      <div className="palette" role="dialog" aria-label="Command palette" data-testid="palette">
        <div className="pal-in">
          <Icon name="search" />
          <input autoFocus placeholder="Search threads, tools, files, UI and theme" value={q} onChange={(e) => setQ(e.target.value)} data-testid="palette-input"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]) }
              else if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }} />
        </div>
        <div className="pal-list" ref={list}>
          {!shown.length && <div className="pop-hint">Nothing matches.</div>}
          {shown.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : ''
            lastGroup = c.group
            return (
              <div key={`${c.group}:${c.id}`}>
                {head && <div className="pal-group">{head}</div>}
                <button className={i === sel ? 'pal-row on' : 'pal-row'} onMouseEnter={() => setSel(i)} onClick={() => run(c)} data-testid={`palette-${c.id}`}>
                  <Icon name={c.icon} className={c.mk} />
                  <span className="pal-label">{c.label}</span>
                  {c.hint && <span className="pal-hint">{c.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
