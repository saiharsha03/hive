// The "/" menu of the message box: everything the session can run (built-ins, skills, plugin and custom
// commands) with descriptions; Up / Down to move, Enter or Tab to insert, Esc to close.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { commandGroup, filterCommands, insertCommand, slashQuery, type Command } from '../../shared/composerCore'

// /btw is Hive's own (the engine's is terminal-only): a side question that stays out of the conversation
const BTW: Command = { name: 'btw', description: 'Ask a quick side question about this thread; the answer stays out of the conversation', argumentHint: '<question>', builtin: true }

export function useSlashMenu(tabId: string, draft: string, setDraft: (s: string) => void) {
  const q = slashQuery(draft)
  const [cmds, setCmds] = useState<Command[] | null>(null)
  const [sel, setSel] = useState(0)
  const [closedAt, setClosedAt] = useState<string | null>(null) // Esc hides the menu until the text changes
  const open = q !== null && closedAt !== draft
  const list = open && cmds ? filterCommands(cmds, q) : []
  const listRef = useRef<HTMLDivElement>(null)

  // fresh each time the menu opens: a running session may have found new skills
  useEffect(() => {
    if (!open) return
    let live = true
    window.api.chatCommands(tabId).then((c) => { if (live) setCmds([...c.filter((x) => x.name !== 'btw'), BTW]) }).catch(() => { if (live) setCmds([]) })
    return () => { live = false }
  }, [open, tabId])
  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('.sm-row.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const pick = (c: Command) => setDraft(insertCommand(c))

  // true when the key was the menu's; an exact "/name" already typed still sends on Enter
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || !list.length) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % list.length); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + list.length) % list.length); return true }
    if (e.key === 'Escape') { e.preventDefault(); setClosedAt(draft); return true }
    if ((e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey) || e.key === 'Tab') {
      const c = list[Math.min(sel, list.length - 1)]
      if (e.key === 'Enter' && draft === `/${c.name}`) return false
      e.preventDefault()
      pick(c)
      return true
    }
    return false
  }

  const menu = open && (cmds === null || list.length > 0) ? (
    <div data-testid="slash-menu" className="slashmenu" ref={listRef} role="listbox">
      {cmds === null && <div className="sm-hint">Loading commands…</div>}
      {list.map((c, i) => (
        <div data-testid="slash-item" key={`${c.name}:${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'sm-row on' : 'sm-row'}
          onMouseDown={(e) => { e.preventDefault(); pick(c) }} onMouseEnter={() => setSel(i)}>
          <span className="sm-name">/{c.name}{c.argumentHint ? <span className="sm-arg"> {c.argumentHint}</span> : null}</span>
          <span className="sm-desc">{c.description}</span>
          <span className="sm-group">{commandGroup(c)}</span>
        </div>
      ))}
    </div>
  ) : null

  return { menu, onKey }
}
