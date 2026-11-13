// What is coming up for a thread, in its header: its loops, wake-ups and a pending automatic continue ("1 loop and
// 1 wake-up, next 14:30"). Open, a row each: what, when, its schedule and the prompt it will run. useComingUp is the one
// assembly of that list; the Activity panel reads it too. It reads the status store and the wake-up list, never the
// conversation, so a streaming reply does not re-render it.
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useThreadStatus } from './statusStore'
import { useNow } from './ThreadStatus'
import { onWakeupsChanged, wakeupsCancel, wakeupsList, type Wakeups } from './api/next'
import { Btn, clock, relative } from './kit'
import { Confirm, useEscape } from './ui'
import { KIND_WORD, SOON_MS, comingLabel, comingUp, nearest, type Coming } from '../../shared/comingCore'

export function useComingUp(tabId: string | undefined, sessionId: string | null | undefined): { rows: Coming[]; reload: () => void; paused: boolean } {
  const st = useThreadStatus(tabId)
  const [wakes, setWakes] = useState<Wakeups | null>(null)
  const reload = useCallback(() => void wakeupsList().then((r) => setWakes(r.ok ? r.data : null)), [])
  useEffect(() => { reload(); return onWakeupsChanged(reload) }, [reload])
  const rows = tabId ? comingUp({ tabId, sessionId, crons: st.crons, nextWake: st.nextWake, wakeups: wakes?.wakeups ?? [], continues: wakes?.continues ?? [] }, Date.now()) : []
  // paused: wake-ups and automatic continues are held (Stop everything, or a build that never fires them); loops still run
  return { rows, reload, paused: !!wakes?.paused }
}

export const ComingBar = memo(function ComingBar({ tabId, sessionId, onResume, onCancelContinue, onScheduled }: {
  tabId: string; sessionId?: string
  onResume: () => Promise<void>; onCancelContinue: () => Promise<void> // the automatic continue's own two actions
  onScheduled: () => void
}) {
  const { rows, reload, paused } = useComingUp(tabId, sessionId)
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<string | null>(null) // the row whose whole prompt shows
  const [asking, setAsking] = useState<Coming | null>(null) // the wake-up a Cancel is being confirmed for
  const [err, setErr] = useState('')
  const now = Date.now()
  // the clock runs while the list is open or the nearest item is minutes away; before that, one render when it gets near
  const at = nearest(rows)
  const soon = at !== null && at - now < SOON_MS && at - now > -60_000
  useNow(open || soon)
  const [, wake] = useState(0)
  useEffect(() => {
    if (at === null || soon) return
    const t = setTimeout(() => wake((n) => n + 1), Math.min(2 ** 31 - 1, Math.max(1000, at - Date.now() - SOON_MS + 500)))
    return () => clearTimeout(t)
  }, [at, soon])
  const button = useRef<HTMLButtonElement>(null)
  useEscape(() => { setOpen(false); button.current?.focus() }, open && rows.length > 0)
  if (!rows.length) return null
  // held: a wake-up or continue that will not fire by itself while paused. It must say so, or it reads as broken
  const isHeld = (r: Coming) => paused && r.kind !== 'loop'
  const held = rows.filter(isHeld)
  // one line per kind (loops, wake-ups, the automatic continue), each with its own next time; a held kind says held
  const lineOf = (kind: Coming['kind']): string => {
    const of = rows.filter((r) => r.kind === kind)
    if (!of.length) return ''
    return of.every(isHeld) ? `${comingLabel(of, now).split(', next')[0]}, held` : comingLabel(of, now)
  }
  const lines = (['loop', 'wake', 'continue'] as Coming['kind'][]).map(lineOf).filter(Boolean)
  const cancelWake = (r: Coming) => {
    setAsking(null)
    void wakeupsCancel('wake', r.id!).then((a) => { if (a.ok) { setErr(''); reload() } else setErr(a.reason) })
  }
  return (
    <span className="coming">
      <button ref={button} className={held.length ? 'coming-b held' : 'coming-b'} onClick={() => setOpen(!open)} aria-expanded={open} title={held.length ? 'Scheduled for this thread. Wake-ups are held, so they will not fire by themselves' : 'What is scheduled for this thread'} data-testid="coming-bar">
        {lines.map((l) => <span key={l} className="coming-ln">{l}</span>)}<b hidden data-testid="coming-count">{rows.length}</b>
      </button>
      {open && (
        <div className="coming-list" data-testid="coming-list">
          {rows.map((r, n) => (
            <div key={r.key} className="coming-row">
              <button className="coming-h" onClick={() => setFull(full === r.key ? null : r.key)} aria-expanded={full === r.key} title={full === r.key ? 'Show less of the prompt' : 'Show the whole prompt'} data-testid={`coming-row-${n}`}>
                <span className="coming-k"><b>{KIND_WORD[r.kind]}</b>{r.at !== null ? `${clock(r.at)}, ${isHeld(r) ? 'held' : relative(r.at, now)}` : 'no next time'}{r.how !== 'once' ? `, ${r.how}` : ''}</span>
                <span className={full === r.key ? 'coming-w full' : 'coming-w'}>{r.what}</span>
              </button>
              {(r.kind === 'continue' || (r.kind === 'wake' && !r.own)) && (
                <span className="coming-a">
                  {r.kind === 'continue' && <Btn kind="link" onClick={() => void onResume().then(reload)} testid={`coming-resume-${n}`}>Resume now</Btn>}
                  {r.kind === 'continue' && <Btn kind="link" onClick={() => void onCancelContinue().then(reload)} testid={`coming-cancel-${n}`}>Cancel</Btn>}
                  {r.kind === 'wake' && <Btn kind="link" onClick={() => setAsking(r)} testid={`coming-cancel-${n}`}>Cancel</Btn>}
                </span>
              )}
            </div>
          ))}
          {held.length > 0 && <div className="coming-note" data-testid="coming-held">Held: wake-ups and automatic continues are switched off here, so {held.length === 1 ? 'this waits' : 'these wait'} until you run {held.length === 1 ? 'it' : 'them'} from Scheduled.</div>}
          {err && <div className="coming-f s-fail">Not cancelled: {err}</div>}
          <div className="coming-f"><Btn kind="link" onClick={() => { setOpen(false); onScheduled() }} testid="coming-scheduled">Scheduled</Btn></div>
        </div>
      )}
      {asking && (
        <Confirm title="Drop this wake-up?" action="Drop the wake-up" danger onConfirm={() => cancelWake(asking)} onCancel={() => setAsking(null)} testid="coming-confirm">
          It will not run{asking.at !== null ? ` at ${clock(asking.at)}` : ''}: {asking.what}
        </Confirm>
      )}
    </span>
  )
})
