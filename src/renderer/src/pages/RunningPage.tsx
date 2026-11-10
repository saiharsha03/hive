// Running: every subagent, shell, monitor and Codex run in every thread, what just happened, and Stop everything.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Btn, ConfirmBar, Empty, Keys, PageHead, Section, State, dur, clock, taskState } from '../kit'
import { useAllStatus } from '../statusStore'
import { useSessionMetas } from '../store'
import { activate, send, stopEverything, stopEverythingCount } from '../actions'
import { kindLabel, lastOutput, nowNote, nowRows, trail, type RunRow } from './runningCore'
import { age } from '../kit'
import type { Task } from '../../../shared/taskCore'
import './running.css'

function useTick(ms: number): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return n
}

export function RunningPage() {
  const all = useAllStatus()
  const metas = useSessionMetas()
  const now = useTick(1000)
  const [asking, setAsking] = useState<string | null>(null) // row key whose message box is open
  const [text, setText] = useState('')
  const [open, setOpen] = useState<string | null>(null) // row key whose log is open

  const rows = useMemo<RunRow<Task>[]>(() => {
    const title = new Map(metas.map((m) => [m.id, m.title]))
    return [...all].flatMap(([tabId, st]) => st.tasks.map((task) => ({ tabId, thread: title.get(tabId) || tabId, task })))
  }, [all, metas])
  const shown = nowRows(rows, now)
  const events = useMemo(() => trail(rows), [rows])
  const counts = stopEverythingCount()
  const keyOf = (r: RunRow) => `${r.tabId}:${r.task.id}`

  const submit = (tabId: string) => {
    const t = text.trim()
    if (t) send(tabId, t, [], 'steer')
    setAsking(null); setText('')
  }

  return (
    <div className="page" data-testid="page-running">
      <PageHead title="Running" desc="Every subagent, shell, monitor and Codex run, in every thread" right={<Keys k="Ctrl Shift R" />} />
      <Section title="Now" note={nowNote(rows, now)} testid="running-now">
        {shown.length === 0 ? <Empty>Nothing is running.</Empty> : (
          <table className="dt">
            <thead>
              <tr><th>State</th><th>Kind</th><th>What</th><th>Thread</th><th className="num">For</th><th>Last output</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const t = r.task
                const k = keyOf(r)
                const running = t.status === 'running'
                const st = taskState(t.status)
                return (
                  <Fragment key={k}>
                    <tr className={t.status === 'failed' ? 'fail' : ''} data-testid="run-row">
                      <td><State word={st.word} tone={st.tone} /></td>
                      <td>{kindLabel(t.kind)}</td>
                      <td className="run-what">{t.title}</td>
                      <td className="run-thread">{r.thread}</td>
                      <td className="num run-for">{running ? dur(now - t.startedAt) : now - (t.endedAt ?? t.startedAt) < 60_000 ? 'just ended' : `ended ${age(t.endedAt ?? t.startedAt, now)} ago`}</td>
                      <td className="out" title={lastOutput(t)}>{lastOutput(t)}</td>
                      <td className="acts">
                        {running && <Btn kind="link" onClick={() => { setAsking(asking === k ? null : k); setText('') }}>Message</Btn>}
                        <Btn kind="link" onClick={() => activate(r.tabId)}>Open</Btn>
                        {running
                          ? <Btn kind="link" className="x" onClick={() => void window.api.chatStopTask(r.tabId, t.id)}>Stop</Btn>
                          : <Btn kind="link" onClick={() => setOpen(open === k ? null : k)}>Log</Btn>}
                      </td>
                    </tr>
                    {asking === k && (
                      <tr><td colSpan={7}>
                        <div className="run-ask">
                          <span className="run-ask-to">Message to {r.thread}</span>
                          <input
                            className="uline" autoFocus value={text} placeholder="Type a line and press Enter" aria-label={`Message to ${r.thread}`}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') submit(r.tabId); else if (e.key === 'Escape') { setAsking(null); setText('') } }}
                          />
                        </div>
                      </td></tr>
                    )}
                    {open === k && !running && (
                      <tr className="run-logrow"><td colSpan={7}>
                        <div className="log">
                          {[t.error && `Error: ${t.error}`, t.summary, ...t.agents.map((a) => `${a.label}: ${a.state}${a.result ? `, ${a.result}` : ''}`)].filter(Boolean).join('\n') || 'No output was kept.'}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Trail" note="What started, finished or failed, newest first" testid="running-trail">
        {events.length === 0 ? <Empty>Nothing has happened yet.</Empty> : (
          <ul className="run-trail">
            {events.map((e) => (
              <li key={e.key} className="run-tr">
                <span className="run-tr-t">{clock(e.at)}</span>
                <State word={e.word} tone={e.tone} />
                <span className="run-tr-w">{e.text}</span>
                <span className="run-tr-d" title={e.detail}>{e.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ConfirmBar
        testid="stop-everything-bar"
        actions={<><Btn kind="danger" onClick={() => void stopEverything()}>Stop everything</Btn><Keys k="Ctrl Alt Esc" /></>}
      >
        Stop everything: interrupts {counts.threads} thread{counts.threads === 1 ? '' : 's'}, stops {counts.tasks} task{counts.tasks === 1 ? '' : 's'}, holds every queue. Wake-ups stay scheduled.
      </ConfirmBar>
    </div>
  )
}
