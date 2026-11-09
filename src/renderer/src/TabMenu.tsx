// Right-click menu for a tab, like Chrome's. Closes on an outside click or Escape.
import { useEffect, useRef, useState } from 'react'
import { tabsToClose, type TabCloseAction } from './tabs'

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

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])

  return (
    <div className="tmenu" ref={ref} style={{ ...pos, width: 210 }} onContextMenu={(e) => e.preventDefault()}>
      {ITEMS.map((it) => (
        <button data-testid="tabmenu-button-1" key={it.action} disabled={!tabsToClose(ids, target, it.action).length} onClick={() => { onPick(it.action); onClose() }}>{it.label}</button>
      ))}
      <button data-testid="tabmenu-button-2" className="tsep" onClick={() => { onBackground(); onClose() }}>Move to background</button>
    </div>
  )
}
