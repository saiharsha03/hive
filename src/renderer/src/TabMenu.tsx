// Right-click menu for a tab, like Chrome's. Closes on an outside click or Escape.
import { useEffect, useRef, useState } from 'react'
import { tabsToClose, type TabCloseAction } from './tabs'
import { useEscape, useMenuKeys } from './ui'

const ITEMS: { action: TabCloseAction; label: string }[] = [
  { action: 'close', label: 'Close' },
  { action: 'others', label: 'Close other tabs' },
  { action: 'right', label: 'Close tabs to the right' },
  { action: 'left', label: 'Close tabs to the left' },
  { action: 'all', label: 'Close all tabs' },
]

type Props = { ids: string[]; target: string; x: number; y: number; onPick: (a: TabCloseAction) => void; onBackground: () => void; onClose: () => void }

export function TabMenu({ ids, target, x, y, onPick, onBackground, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ left: Math.max(4, Math.min(x, innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, innerHeight - r.height - 4)) })
  }, [x, y])

  const close = useRef(onClose)
  close.current = onClose
  useEscape(() => close.current())
  const keys = useMenuKeys(ref)
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close.current() }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [])

  return (
    <div className="tmenu" role="menu" ref={ref} style={{ ...pos, width: 210 }} onKeyDown={keys} onContextMenu={(e) => e.preventDefault()}>
      {ITEMS.map((it) => (
        <button data-testid="tabmenu-button-1" key={it.action} disabled={!tabsToClose(ids, target, it.action).length} onClick={() => { onPick(it.action); onClose() }}>{it.label}</button>
      ))}
      <button data-testid="tabmenu-button-2" className="tsep" onClick={() => { onBackground(); onClose() }}>Move to background</button>
    </div>
  )
}
