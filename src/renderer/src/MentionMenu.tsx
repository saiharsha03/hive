// The "@" menu of the message box: files under the thread's folder; Up / Down to move, Enter or Tab to insert,
// Esc to close. Same shape and keys as the "/" menu.
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { filterPaths, insertMention, mentionAt } from '../../shared/mentionCore'
import { Icon } from './ui'

const SHOWN = 50

export function useMentionMenu(cwd: string, draft: string, caret: number, box: RefObject<HTMLTextAreaElement | null>, setDraft: (s: string) => void) {
  const m = mentionAt(draft, caret)
  const [files, setFiles] = useState<string[] | null>(null)
  const [sel, setSel] = useState(0)
  const [closedAt, setClosedAt] = useState<string | null>(null) // Esc hides the menu until the text changes
  const open = m !== null && closedAt !== draft
  const list = open && files ? filterPaths(files, m.query).slice(0, SHOWN) : []
  const listRef = useRef<HTMLDivElement>(null)

  // fresh each time the menu opens (main caches for a few seconds)
  useEffect(() => {
    if (!open) return
    if (!cwd) { setFiles([]); return }
    let live = true
    window.api.listAllFiles(cwd).then((f) => { if (live) setFiles(f) }).catch(() => { if (live) setFiles([]) })
    return () => { live = false }
  }, [open, cwd])
  useEffect(() => { setSel(0) }, [m?.query])
  useEffect(() => { listRef.current?.querySelector('.sm-row.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const pick = (path: string) => {
    if (!m) return
    const r = insertMention(draft, m, path)
    setDraft(r.text)
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(r.caret, r.caret) })
  }

  // true when the key was the menu's
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || !list.length) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % list.length); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + list.length) % list.length); return true }
    if (e.key === 'Escape') { e.preventDefault(); setClosedAt(draft); return true }
    if ((e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey) || e.key === 'Tab') {
      e.preventDefault()
      pick(list[Math.min(sel, list.length - 1)])
      return true
    }
    return false
  }

  const menu = open && (files === null || list.length > 0) ? (
    <div data-testid="mention-menu" className="slashmenu" ref={listRef} role="listbox">
      {files === null && <div className="sm-hint">Loading files…</div>}
      {list.map((p, i) => {
        const cut = p.lastIndexOf('/')
        return (
          <div data-testid="mention-item" key={p} role="option" aria-selected={i === sel} className={i === sel ? 'sm-row on' : 'sm-row'}
            onMouseDown={(e) => { e.preventDefault(); pick(p) }} onMouseMove={() => setSel(i)}>
            <Icon name="file" />
            <span className="sm-name">{p.slice(cut + 1)}</span>
            <span className="sm-desc">{cut >= 0 ? p.slice(0, cut) : ''}</span>
          </div>
        )
      })}
    </div>
  ) : null

  return { menu, onKey }
}
