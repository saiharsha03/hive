// Small shared pieces: codicons, popovers anchored to a button, focused modals, and resizable dividers
// whose sizes are kept in prefs.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE, type ReactNode } from 'react'
import { getPref, setPref } from './prefs'

export const Icon = ({ name, className = '', title, style }: { name: string; className?: string; title?: string; style?: CSSProperties }) =>
  <span className={`codicon codicon-${name} ${className}`} title={title} style={style} aria-hidden={title ? undefined : true} />

// close on a click outside `ref` (and outside any other open popover or menu) or on Escape
export function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (ref.current?.contains(t)) return
      // a menu opened from inside this popover (a context menu) is not "outside"
      if (t.closest?.('.tmenu')) return
      close.current()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    const t = setTimeout(() => document.addEventListener('mousedown', down))
    document.addEventListener('keydown', key)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [])
}

export type Anchor = { left: number; top: number; right: number; bottom: number }
export const anchorOf = (el: Element | null | undefined): Anchor => {
  const r = el?.getBoundingClientRect()
  return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : { left: innerWidth / 2 - 220, top: 48, right: innerWidth / 2 + 220, bottom: 48 }
}

// A popover under (or above, when there is no room) an anchor rect, kept inside the window.
export function Popover({ anchor, onClose, children, width, className = '', testid, align = 'left' }: {
  anchor: Anchor; onClose: () => void; children: ReactNode; width?: number; className?: string; testid?: string; align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>({ left: anchor.left, top: anchor.bottom + 2, visibility: 'hidden' })
  useDismiss(ref, onClose)
  useLayoutEffect(() => {
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      let left = align === 'right' ? anchor.right - r.width : anchor.left
      left = Math.max(4, Math.min(left, innerWidth - r.width - 4))
      let top = anchor.bottom + 2
      if (top + r.height > innerHeight - 4) top = Math.max(4, Math.min(anchor.top - r.height - 2, innerHeight - r.height - 4))
      setPos({ left, top })
    }
    place()
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [anchor.left, anchor.top, anchor.right, anchor.bottom, align])
  return (
    <div className={`pop ${className}`} ref={ref} style={{ ...pos, width }} data-testid={testid} role="dialog">
      {children}
    </div>
  )
}

// A focused modal over a dimmed window; Escape or the backdrop closes it
export function Modal({ title, onClose, children, wide, testid, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; testid?: string; actions?: ReactNode }) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.pop')) close.current() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-testid={testid ? `${testid}-scrim` : undefined}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" data-testid={testid}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          {actions}
          <button className="ibtn" aria-label="Close" title="Close (Esc)" onClick={onClose} data-testid={testid ? `${testid}-close` : undefined}><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// a size in px kept in prefs under `key`: [value, set while dragging, save when done]
export function useSize(key: string, fallback: number): [number, (n: number) => void, (n: number) => void] {
  const [n, setN] = useState(() => getPref<number>(`size.${key}`, fallback))
  return [n, setN, (v: number) => setPref(`size.${key}`, Math.round(v))]
}

function drag(dir: 'v' | 'h', e: RPE<HTMLDivElement>, onMove: (p: number) => void, onUp: () => void) {
  e.preventDefault()
  document.body.classList.add(dir === 'v' ? 'dragging-v' : 'dragging-h')
  const move = (ev: PointerEvent) => onMove(dir === 'v' ? ev.clientX : ev.clientY)
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
    document.body.classList.remove('dragging-v', 'dragging-h')
    onUp()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// A draggable divider. dir 'v' sits between columns (drags x), 'h' between rows (drags y).
// sign: +1 when dragging right / down grows the region, -1 when it shrinks it.
export function Divider({ dir, size, setSize, save, min = 140, max = 2000, sign = 1, testid }: {
  dir: 'v' | 'h'; size: number; setSize: (n: number) => void; save: (n: number) => void; min?: number; max?: number; sign?: 1 | -1; testid?: string
}) {
  const down = (e: RPE<HTMLDivElement>) => {
    const p0 = dir === 'v' ? e.clientX : e.clientY
    const s0 = size
    let s = s0
    drag(dir, e, (p) => { s = Math.round(Math.max(min, Math.min(max, s0 + sign * (p - p0)))); setSize(s) }, () => save(s))
  }
  return <div className={`divider ${dir}`} onPointerDown={down} role="separator" aria-orientation={dir === 'v' ? 'vertical' : 'horizontal'} data-testid={testid} />
}

// a fraction (0..1) kept in prefs, for dividers inside the chat grid
export function useFraction(key: string, fallback: number): [number, (n: number) => void, (n: number) => void] {
  const [n, setN] = useState(() => getPref<number>(`frac.${key}`, fallback))
  return [n, setN, (v: number) => setPref(`frac.${key}`, v)]
}

export function FracDivider({ dir, setFrac, save, container, testid, style }: {
  dir: 'v' | 'h'; setFrac: (n: number) => void; save: (n: number) => void; container: React.RefObject<HTMLElement | null>; testid?: string; style?: CSSProperties
}) {
  const down = (e: RPE<HTMLDivElement>) => {
    const r = container.current?.getBoundingClientRect()
    if (!r) return
    let f = 0.5
    drag(dir, e, (p) => {
      f = Math.max(.15, Math.min(.85, dir === 'v' ? (p - r.left) / r.width : (p - r.top) / r.height))
      setFrac(f)
    }, () => save(f))
  }
  return <div className={`divider ${dir} abs`} style={style} onPointerDown={down} role="separator" data-testid={testid} />
}
