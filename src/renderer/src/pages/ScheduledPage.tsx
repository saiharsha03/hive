// Scheduled: wake-ups, loops, auto-continue and watcher runs on a 24-hour strip and in a table.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Btn, Empty, PageHead, Section, Unavailable } from '../kit'
import { useAllStatus } from '../statusStore'
import { useSessionMetas } from '../store'
import { notice, offerUndo, openPage, send } from '../actions'
import { pickWatcher } from '../WatchersView'
import { onWakeupsChanged, wakeupsCancel, wakeupsList, wakeupsRunNow, type Wakeups } from '../api/next'
import type { WatcherSummary } from '../../../shared/watchersCore'
import { bigTime, layoutStrip, scheduleRows, ticksOf, type SchedKind, type SchedRow } from './runningCore'
import './running.css'

const KCLASS: Record<SchedKind, string> = { 'WAKE-UP': 'k-wakeup', LOOP: 'k-loop', 'AUTO-CONTINUE': 'k-continue', WATCHER: 'k-watcher' }
const ROW_H = 24

function useTick(ms: number): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return n
}

export function ScheduledPage() {
  const all = useAllStatus()
  const metas = useSessionMetas()
  const now = useTick(15_000)
  const [wake, setWake] = useState<{ ok: true; data: Wakeups } | { ok: false; reason: string } | null>(null)
  const [watchers, setWatchers] = useState<WatcherSummary[]>([])
  const [watchersErr, setWatchersErr] = useState('')

  const loadWake = useCallback(() => { void wakeupsList().then(setWake) }, [])
  const loadWatchers = useCallback(() => {
    window.api.watchersList().then((l) => { setWatchers(l.watchers); setWatchersErr('') }).catch((e) => setWatchersErr(String((e as Error)?.message ?? e)))
  }, [])
  useEffect(() => {
    loadWake(); loadWatchers()
    const offA = onWakeupsChanged(loadWake)
    const offB = window.api.onWatchersChanged(loadWatchers)
    const t = setInterval(() => { loadWake(); loadWatchers() }, 30_000)
    return () => { offA(); offB(); clearInterval(t) }
  }, [loadWake, loadWatchers])

  const rows = useMemo(() => {
    const title = new Map(metas.map((m) => [m.id, m.title]))
    return scheduleRows({
      wakeups: wake?.ok ? wake.data.wakeups.filter((w) => !w.firedAt) : [],
      continues: wake?.ok ? wake.data.continues : [],
      threads: [...all].map(([tabId, st]) => ({ tabId, title: title.get(tabId) || tabId, crons: st.crons, nextWake: st.nextWake })),
      watchers: watchers.filter((w) => !w.builtin || w.enabled).map((w) => ({ id: w.id, name: w.name, goal: w.goal, enabled: w.enabled, nextRun: w.nextRun, every: w.schedule.every })),
    }, now)
  }, [all, metas, wake, watchers, now])
  const paused = watchers.filter((w) => !w.enabled)
  const strip = useMemo(() => layoutStrip(ticksOf(rows, now), now), [rows, now])

  const runNow = (r: SchedRow) => {
    if (r.kind === 'WATCHER') void window.api.watcherRun(String(r.id), 'sweep')
    else if (r.kind === 'LOOP' && r.tabId) { const p = loopPrompt(all.get(r.tabId)?.crons, r.id); if (p) send(r.tabId, p, [], 'steer') }
    else if (r.kind === 'WAKE-UP' && r.id !== undefined) void wakeupsRunNow('wake', r.id).then((a) => { if (!a.ok) notice(a.reason) })
    else if (r.kind === 'AUTO-CONTINUE' && r.id !== undefined) void wakeupsRunNow('continue', r.id).then((a) => { if (!a.ok) notice(a.reason) })
  }
  const canRun = (r: SchedRow) => r.kind === 'WATCHER' || r.kind === 'LOOP' ? true : r.id !== undefined && !!wake?.ok
  const cancel = (r: SchedRow) => {
    if (r.kind === 'WATCHER') {
      const id = String(r.id)
      void window.api.watcherEnable(id, false)
      offerUndo(`Paused ${r.thread}`, () => { void window.api.watcherEnable(id, true) })
    } else if (r.kind === 'WAKE-UP' && r.id !== undefined) {
      void wakeupsCancel('wake', r.id).then((a) => { if (!a.ok) notice(a.reason); else loadWake() })
    } else if (r.kind === 'AUTO-CONTINUE') {
      void wakeupsCancel('continue', r.id as string).then((a) => {
        if (a.ok) loadWake()
        else if (r.tabId) void window.api.chatCancelContinue(r.tabId).then(loadWake)
      })
    }
  }
  const canCancel = (r: SchedRow) => r.kind === 'WATCHER' || r.kind === 'AUTO-CONTINUE' || (r.kind === 'WAKE-UP' && r.id !== undefined && !!wake?.ok)
  const cancelWhy = (r: SchedRow) => (canCancel(r) ? undefined : r.kind === 'LOOP' ? 'Ask the thread to stop this loop' : r.kind === 'WAKE-UP' && r.tabId ? 'The thread set this itself; ask it to stop' : 'Not available yet')

  return (
    <div className="page" data-testid="page-scheduled">
      <PageHead title="Scheduled" desc="Wake-ups, loops, auto-continue and watcher runs. All of them survive a restart." right={<span>{rows.length} scheduled</span>} />

      <div className="sch-strip" data-testid="sch-strip" role="img" aria-label="Next 24 hours of scheduled events">
        {strip.hours.map((h, i) => <div key={i} className="sch-hr" style={{ left: `${h.x * 100}%` }}>{i > 0 && i % 2 === 0 ? h.label : ''}</div>)}
        <div className="sch-now" style={{ left: `${strip.nowX * 100}%` }}><span>{new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
        {strip.ticks.map((t) => {
          const top = 24 + t.row * ROW_H
          return (
            <span key={t.key}>
              {t.band !== null && <span className="sch-band" style={{ left: `${t.x * 100}%`, width: `${(t.band - t.x) * 100}%`, top: top - 5 }} />}
              <span className={`sch-ev ${KCLASS[t.kind]}`} style={{ left: `${t.x * 100}%`, top }} title={t.label}>{t.clipped ? '' : t.label}</span>
            </span>
          )
        })}
      </div>

      <Section title="Coming up" testid="sch-rows">
        {wake && !wake.ok && <Unavailable reason={`Wake-ups and auto-continue: ${wake.reason}`} />}
        {watchersErr && <Unavailable reason={`Watchers: ${watchersErr}`} />}
        {rows.length === 0 ? <Empty>Nothing is scheduled.</Empty> : (
          <table className="dt">
            <thead>
              <tr><th>When</th><th /><th>Kind</th><th>Thread</th><th>What it will do</th><th>Repeats</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid="sch-row">
                  <td className="big sch-when">{r.every ?? (r.at ? bigTime(r.at, now) : 'soon')}</td>
                  <td className="sch-rel">{r.rel}</td>
                  <td><span className="kind-word">{r.kind.toLowerCase()}</span></td>
                  <td>{r.thread}</td>
                  <td className="sch-what">{r.what}</td>
                  <td className="sch-rel">{r.repeats}</td>
                  <td className="acts">
                    <Btn kind="link" disabled={!canRun(r)} onClick={() => runNow(r)}>Run now</Btn>
                    {r.kind === 'WATCHER'
                      ? <Btn kind="link" onClick={() => { openPage('watchers'); pickWatcher(String(r.id)) }}>Edit</Btn>
                      : <Btn kind="link" disabled title={r.kind === 'LOOP' ? 'Ask the thread to change the loop' : 'Cancel it and set a new one; editing is not available yet'}>Edit</Btn>}
                    <Btn kind="link" className="x" disabled={!canCancel(r)} title={cancelWhy(r)} onClick={() => cancel(r)}>Cancel</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Paused by you" testid="sch-paused">
        {paused.length === 0 ? <Empty>Nothing paused.</Empty> : (
          <table className="dt">
            <tbody>
              {paused.map((w) => (
                <tr key={w.id}>
                  <td className="strong">{w.name}</td>
                  <td className="sch-rel">{w.goal}</td>
                  <td><span className="kind-word">watcher</span></td>
                  <td className="acts">
                    <Btn kind="link" onClick={() => void window.api.watcherEnable(w.id, true)}>Resume</Btn>
                    <Btn kind="link" onClick={() => { openPage('watchers'); pickWatcher(w.id) }}>Edit</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

const loopPrompt = (crons: { id: string; prompt: string }[] | undefined, id: string | number | undefined): string => crons?.find((c) => c.id === id)?.prompt ?? ''
