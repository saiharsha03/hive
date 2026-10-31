// The title bar: the honeycomb, name and tagline, the Thread / View / Tools menus, the Ctrl+K search, the Watchers
// control, region toggles and Settings. The whole bar drags the window; Windows draws min / max / close on the right.
import { useRef, useState, type ReactNode } from 'react'
import { useAppName, useAppTagline } from './appSettings'
import { HiveMark } from './HiveMark'
import { Icon, Popover, anchorOf, type Anchor } from './ui'
import { WatchersButton } from './watchers'

export type MenuItem = { label: string; hint?: string; icon?: string; checked?: boolean; sep?: boolean; disabled?: boolean; onClick: (el: HTMLElement | null) => void; testid: string }
export type Menu = { label: string; items: MenuItem[] }

export function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  return (
    <div className="poplist menu">
      {items.map((it, i) => (
        <button key={i} className={`pop-row${it.sep ? ' sep' : ''}`} disabled={it.disabled} data-testid={it.testid}
          onClick={(e) => { const el = e.currentTarget; onDone(); it.onClick(el) }}>
          <Icon name={it.checked ? 'check' : it.icon ?? 'blank'} />
          <span className="pop-label">{it.label}</span>
          {it.hint && <span className="pop-note">{it.hint}</span>}
        </button>
      ))}
    </div>
  )
}

export function TitleBar({ menus, onPalette, onWatchers, toggles, onSettings }: {
  menus: Menu[]; onPalette: () => void; onWatchers: (el: HTMLElement) => void
  toggles: { icon: string; on: boolean; title: string; onClick: () => void; testid: string }[]; onSettings: () => void
}) {
  const name = useAppName()
  const tagline = useAppTagline()
  const [open, setOpen] = useState<{ i: number; anchor: Anchor } | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <header className="title" data-testid="title-bar">
      <div className="tl">
        <span className="brand" title={tagline || name} data-testid="brand"><HiveMark /><b>{name}</b>{tagline && <span className="tagline">{tagline}</span>}</span>
        <nav className="menus">
          {menus.map((m, i) => (
            <button key={m.label} ref={(el) => { refs.current[i] = el }} className={open?.i === i ? 'mbtn on' : 'mbtn'} data-testid={`menu-${m.label.toLowerCase()}`}
              onClick={() => setOpen(open?.i === i ? null : { i, anchor: anchorOf(refs.current[i]) })}
              onMouseEnter={() => { if (open && open.i !== i) setOpen({ i, anchor: anchorOf(refs.current[i]) }) }}>{m.label}</button>
          ))}
        </nav>
      </div>
      <button className="find" onClick={onPalette} data-testid="titlebar-search"><Icon name="search" />Search threads, tools and files<kbd>Ctrl K</kbd></button>
      <div className="tr">
        <WatchersButton onClick={onWatchers} />
        {toggles.map((t) => <button key={t.testid} className={t.on ? 'tbtn ic on' : 'tbtn ic'} title={t.title} onClick={t.onClick} data-testid={t.testid}><Icon name={t.icon} /></button>)}
        <button className="tbtn ic" title="Settings (Ctrl+,)" onClick={onSettings} data-testid="titlebar-settings"><Icon name="settings-gear" /></button>
      </div>
      {open && (
        <Popover anchor={open.anchor} onClose={() => setOpen(null)} width={290} testid={`menu-${menus[open.i].label.toLowerCase()}-list`}>
          <MenuList items={menus[open.i].items} onDone={() => setOpen(null)} />
        </Popover>
      )}
    </header>
  )
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>
