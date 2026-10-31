// Where the watchers show outside the Watchers view: the compact title-bar control ("Watchers 3/4", blinking amber when
// one waits for you), its popover (WatchersToggleList plus "Open Watchers") and the sidebar section rows. All read the
// same useWatchers store, so a switch flipped in one place shows everywhere.
import { useRef, useState } from 'react'
import { useWatchers, type WatcherRow } from './useWatchers'
import { WatchersToggleList } from './WatchersView'
import { Icon } from './ui'

const when = (t: number | null) => {
  if (!t) return '-'
  const d = new Date(t)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

export function stateWord(w: WatcherRow): { word: string; cls: string } {
  if (w.waiting) return { word: 'WAITING', cls: 's-wait blink' }
  if (w.state === 'running') return { word: 'RUNNING', cls: 's-work' }
  if (w.state === 'failed') return { word: 'FAILED', cls: 's-fail' }
  if (!w.enabled) return { word: 'OFF', cls: 's-idle' }
  return { word: 'ON', cls: 's-done' }
}

function Switch({ on, onChange, label, testid, busy }: { on: boolean; onChange: (v: boolean) => void; label: string; testid: string; busy?: boolean }) {
  return (
    <button className={on ? 'switch on' : 'switch'} role="switch" aria-checked={on} aria-label={label} title={on ? 'On' : 'Off'} disabled={busy}
      onClick={(e) => { e.stopPropagation(); onChange(!on) }} data-testid={testid}><i /></button>
  )
}

// sidebar rows: every watcher with its own switch, state, next run and findings; a click opens its detail
export function WatcherRows({ onOpen, compact }: { onOpen: (id: string) => void; compact?: boolean }) {
  const { watchers, busy, setEnabled, error } = useWatchers()
  return (
    <div className="watch-list">
      {!watchers.length && <div className="hint">No watchers yet.</div>}
      {watchers.map((w) => {
        const st = stateWord(w)
        return (
          <div key={w.id} className="watch-row" role="button" tabIndex={0} onClick={() => onOpen(w.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(w.id) }}
            data-testid={`watcher-row-${w.id}`} title={w.message || w.waitingReason || w.goal}>
            <Icon name="eye" className={w.waiting ? 'mk-watch blink' : 'mk-watch'} />
            <span className="watch-name">{w.name}</span>
            <span className={`st ${st.cls}`}>{st.word}</span>
            {!compact && <span className="watch-meta">{w.enabled ? `next ${when(w.nextRun)}` : ''}{w.findings ? `, ${w.findings} ${w.builtin ? 'reviewed' : 'findings'}` : ''}</span>}
            <Switch on={w.enabled} busy={!!busy[w.id]} label={`${w.name} on or off`} onChange={(v) => void setEnabled(w.id, v)} testid={`watcher-toggle-${w.id}`} />
          </div>
        )
      })}
      {error && <div className="derr">{error}</div>}
    </div>
  )
}

// the title-bar control
export function WatchersButton({ onClick }: { onClick: (el: HTMLElement) => void }) {
  const { watchers } = useWatchers()
  const ref = useRef<HTMLButtonElement>(null)
  const on = watchers.filter((w) => w.enabled).length
  const running = watchers.filter((w) => w.state === 'running').length
  const waiting = watchers.some((w) => w.waiting)
  return (
    <button ref={ref} className="tbtn watchers" onClick={() => ref.current && onClick(ref.current)} title={waiting ? 'A watcher is waiting for you' : `${running} running, ${on} on`} data-testid="titlebar-watchers">
      <Icon name="eye" className="mk-watch" />
      <span>Watchers {on}/{watchers.length}</span>
      {waiting && <span className="wait-mark blink" aria-label="waiting" />}
    </button>
  )
}

export function WatchersPopover({ onOpen, onOpenAll }: { onOpen: (id: string) => void; onOpenAll: () => void }) {
  const { watchers } = useWatchers()
  const [, force] = useState(0)
  return (
    <div className="popbody" data-testid="watchers-popover" onClick={() => force((n) => n + 1)}>
      <div className="pop-head"><span>Watchers</span><span className="pop-count">{watchers.filter((w) => w.enabled).length} of {watchers.length} on</span></div>
      <div className="pop-watchers"><WatchersToggleList onPick={onOpen} /></div>
      <div className="pop-foot"><button className="link" onClick={onOpenAll} data-testid="watchers-open-all">Open Watchers</button></div>
    </div>
  )
}

export function useWatcherCounts() {
  const { watchers } = useWatchers()
  return { on: watchers.filter((w) => w.enabled).length, total: watchers.length, waiting: watchers.some((w) => w.waiting), running: watchers.filter((w) => w.state === 'running').length }
}
