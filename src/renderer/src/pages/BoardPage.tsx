// Board: your Jira tickets as columns by status, and a thread started from a card with its first message prepared.
// Read-only: a ticket is moved in Jira, not here. Main does the fetch and keeps the token; this page gets cards.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Btn, Empty, PageHead, State, Unavailable, age, clock, when } from '../kit'
import { useSessionMetas } from '../store'
import { activate, place, threadWithDraft } from '../actions'
import { MAX_PAGES, PAGE_SIZE, columnsOf, filterCards, firstMessage, isUrgent, statusNote, threadFor, threadTitle, typeTone, type Board, type Card } from '../../../shared/trackerCore'
import './board.css'

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const NONE: Card[] = []
// a web link goes to the browser through the window's own open handler (main: setWindowOpenHandler)
const openTicket = (url: string) => { window.open(url, '_blank', 'noreferrer') }

export function BoardPage() {
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const metas = useSessionMetas()
  const load = useCallback(() => {
    setLoading(true)
    window.api.trackerBoard().then(setBoard, (e) => setBoard({ state: 'error', message: clean(e) })).finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const threads = useMemo(() => metas.filter((m) => !m.tool && !m.file), [metas])
  const cards = board?.state === 'ok' ? board.cards : NONE
  const columns = useMemo(() => columnsOf(filterCards(cards, query)), [cards, query])
  const shown = columns.reduce((n, c) => n + c.cards.length, 0)
  // no project-to-repo mapping exists in the app yet, so every ticket's thread starts in the workspace folder
  const start = (c: Card) => threadWithDraft(threadTitle(c), firstMessage(c), place.get().workspace)

  if (board?.state === 'unset') return <div className="page" data-testid="page-board"><PageHead title="Board" /><Unavailable reason={board.message} /></div>
  return (
    <div className="page bd" data-testid="page-board">
      <PageHead title="Board" desc="Your Jira tickets by status" right={board?.state === 'ok' ? <span data-testid="board-at">Read at {clock(board.at)}</span> : undefined} />
      <div className="bd-bar">
        <input className="uline bd-filter" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by key, summary or project" aria-label="Filter tickets" spellCheck={false} data-testid="board-filter" />
        <Btn onClick={load} disabled={loading} testid="board-refresh">{loading ? 'Reading' : 'Refresh'}</Btn>
      </div>
      {board?.state === 'error' && <div className="bd-err" role="alert" data-testid="board-error"><State word="Failed" tone="fail" /><span>{board.message}</span></div>}
      {!board && <Empty>Reading your tickets from Jira.</Empty>}
      {board?.state === 'ok' && cards.length === 0 && <Empty>No open tickets assigned to you.</Empty>}
      {board?.state === 'ok' && cards.length > 0 && shown === 0 && <Empty>No ticket matches the filter.</Empty>}
      {board?.state === 'ok' && board.more && <div className="bd-note">Showing the first {MAX_PAGES * PAGE_SIZE} tickets.</div>}
      {shown > 0 && (
        <div className="bd-cols" data-testid="board-columns">
          {columns.map((col) => (
            <section key={col.id} className={`bd-col bd-s-${col.stage}`} aria-label={col.label} data-testid={`board-col-${col.id}`}>
              <div className="bd-col-head"><span className="bd-col-t">{col.label}</span><span className="bd-col-n">{col.cards.length}</span></div>
              {col.cards.map((c) => {
                const thread = threadFor(c.key, threads)
                const note = statusNote(c)
                return (
                  // Enter on the card itself opens the ticket; Enter on its button stays the button's
                  <article key={c.key} className="bd-card" tabIndex={0} aria-label={`${c.key} ${c.summary}`} data-testid="board-card"
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); openTicket(c.url) } }}>
                    <div className="bd-top">
                      <span className="bd-key">{c.key}</span>
                      {note && <span className="bd-status">{note}</span>}
                      <span className="bd-age" title={c.updated ? `Updated ${when(c.updated)}` : undefined}>{c.updated ? age(c.updated) : ''}</span>
                    </div>
                    <div className="bd-sum">{c.summary}</div>
                    <div className="bd-meta">
                      <span className="bd-tags">
                        {c.type && <b className={`bd-type bd-t-${typeTone(c.type)}`}>{c.type}</b>}
                        {c.priority && <b className={isUrgent(c.priority) ? 'bd-pri hot' : 'bd-pri'}>{c.priority}</b>}
                        <span className="bd-proj">{c.projectName || c.project}</span>
                      </span>
                      {thread
                        ? <Btn kind="link" onClick={() => activate(thread.id)} testid="board-open-thread">Open thread</Btn>
                        : <Btn kind="link" onClick={() => start(c)} testid="board-start-thread">Start thread</Btn>}
                    </div>
                  </article>
                )
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
