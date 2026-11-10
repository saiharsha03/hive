// The design's small parts, shared by every region and page: state words, page and section heads, key-value lists,
// buttons, bars, the confirm bar, and the number and time formats. Styles in shell.css under "kit".
// Rules (the owner's): state is a sentence-case word, coloured only for waiting and failed, never a dot or pill; no
// middle-dot strings; no em dashes; numbers are tabular; zones are told apart by surface, not rules; one primary button.
import { Component, type ReactNode } from 'react'

export type Tone = 'work' | 'wait' | 'fail' | 'done' | 'hold' | 'idle' | 'accent'

// WORKING, WAITING, FAILED, DONE, PAUSED, LOOP ...
export function State({ word, tone, title, testid }: { word: string; tone: Tone; title?: string; testid?: string }) {
  return <span className={`sw sw-${tone}`} title={title} data-testid={testid}>{word.toLowerCase()}</span>
}
// a task's or run's status as its word and tone
export function taskState(status: string): { word: string; tone: Tone } {
  switch (status) {
    case 'running': case 'working': case 'start': return { word: 'WORKING', tone: 'work' }
    case 'completed': case 'done': return { word: 'DONE', tone: 'done' }
    case 'failed': case 'error': return { word: 'FAILED', tone: 'fail' }
    case 'stopped': case 'killed': return { word: 'STOPPED', tone: 'idle' }
    case 'paused': return { word: 'PAUSED', tone: 'hold' }
    case 'waiting': return { word: 'WAITING', tone: 'wait' }
    default: return { word: status.toUpperCase(), tone: 'idle' }
  }
}

// a page's head: title, one line saying what it is, and its shortcut or a link on the right
export function PageHead({ title, desc, right }: { title: string; desc?: ReactNode; right?: ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {desc && <span className="ph-desc">{desc}</span>}
      {right && <span className="ph-right">{right}</span>}
    </header>
  )
}
// a section inside a page or the inspector: a bold label and a dim note on the right, then its rows
export function Section({ title, note, children, testid, className = '' }: { title: ReactNode; note?: ReactNode; children?: ReactNode; testid?: string; className?: string }) {
  return (
    <section className={`sec ${className}`} data-testid={testid}>
      <div className="sec-head"><span className="sec-t">{title}</span>{note !== undefined && <span className="sec-n">{note}</span>}</div>
      {children}
    </section>
  )
}
// two columns, the key dim
export function KV({ rows, testid }: { rows: [ReactNode, ReactNode][]; testid?: string }) {
  return (
    <dl className="kv" data-testid={testid}>
      {rows.map(([k, v], i) => <div key={i} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}
// pinned facts in a pane header: "Pinned  Unique constraint on ...", "Staging  a91f3c2 landed"
export function Pins({ pins }: { pins: [string, ReactNode][] }) {
  if (!pins.length) return null
  return <div className="pins">{pins.map(([k, v], i) => <span key={i} className="pin"><span className="pin-k">{k}</span><span className="pin-v">{v}</span></span>)}</div>
}

type BtnKind = 'primary' | 'plain' | 'danger' | 'link' | 'quiet'
export function Btn({ kind = 'plain', children, onClick, disabled, title, testid, type = 'button', className = '' }: {
  kind?: BtnKind; children: ReactNode; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; title?: string; testid?: string; type?: 'button' | 'submit'; className?: string
}) {
  return <button type={type} className={`btn btn-${kind} ${className}`} onClick={onClick} disabled={disabled} title={title} data-testid={testid}>{children}</button>
}
// a keyboard hint: "Ctrl K", drawn underlined like the mockups
export const Keys = ({ k }: { k: string }) => <kbd className="keys">{k}</kbd>

// usage above this is a warning (amber); below it every percentage and bar is neutral
export const WARN_PCT = 80
// a thin bar: the part used, coloured only when it carries meaning (above WARN_PCT the wait colour)
export function Bar({ pct, tone, width }: { pct: number; tone?: Tone; width?: number | string }) {
  const p = Math.max(0, Math.min(100, pct))
  const t = tone ?? (p >= 95 ? 'fail' : p > WARN_PCT ? 'wait' : 'accent')
  return <span className="bar" style={width !== undefined ? { width } : undefined}><span className={`bar-in bar-${t}`} style={{ width: `${p}%` }} /></span>
}

// a message and its buttons in a raised row (Stop everything, Promote ...)
export function ConfirmBar({ children, actions, testid }: { children: ReactNode; actions: ReactNode; testid?: string }) {
  return <div className="confirmbar" data-testid={testid}><span className="cb-text">{children}</span><span className="cb-acts">{actions}</span></div>
}
// a page's empty line: plain words, no canned starter lists
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty-line">{children}</div>
// "Not available yet" from the adapter
export const Unavailable = ({ reason }: { reason: string }) => <div className="empty-line unavail" data-testid="not-available">{reason}</div>

// a region that fails to draw says so in place; the rest of the window keeps working
export class Boundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error(`${this.props.name} failed to draw:`, error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page" data-testid="region-error">
        <div className="sec-t">{this.props.name} could not be drawn</div>
        <div className="log" style={{ marginTop: 8 }}>{String(this.state.error.stack ?? this.state.error.message).split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10))}</div>
        <div style={{ marginTop: 10 }}><Btn kind="plain" onClick={() => this.setState({ error: null })}>Try again</Btn></div>
      </div>
    )
  }
}

// ---- formats ----
// 38s, 6m 02s, 1h 03m, 2d 4h
export function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return m < 10 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
// 4m, 41m, 2h, Mon, Oct 28: how long ago, short (the rail's age column)
export function age(t: number, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - t) / 60000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24 && new Date(t).toDateString() === new Date(now).toDateString()) return `${h}h`
  const days = (new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000
  if (days < 7) return new Date(t).toLocaleDateString('en-GB', { weekday: 'short' })
  return new Date(t).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
}
// 13:52
export const clock = (t: number | Date): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
// 13:52 today, else "Fri 16:12", else "Oct 28 16:12"
export function when(t: number, now = Date.now()): string {
  const d = new Date(t)
  if (d.toDateString() === new Date(now).toDateString()) return clock(t)
  const days = Math.abs(new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000
  if (days < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${clock(t)}`
  return `${d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} ${clock(t)}`
}
// "in 33m", "in 1h 03m", "2m ago"
export function relative(t: number, now = Date.now()): string {
  const d = t - now
  if (Math.abs(d) < 60_000) return d >= 0 ? 'in under a minute' : 'just now'
  return d > 0 ? `in ${dur(d)}` : `${dur(-d)} ago`
}
// 1.92M, 38.4k, 412
export function tokens(n: number | null | undefined): string {
  if (n == null) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
// a word list with "and": "a, b and c"
export const words = (xs: string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
