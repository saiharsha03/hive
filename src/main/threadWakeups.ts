// Scheduled wake-ups for any thread (the schedule_wakeup tool). Claude Code's own /loop wake-ups and crons live inside
// the session and die when Hive closes; these are rows in one SQLite table under ~/.claude/hive, so they outlive the
// turn, Hive closing and the laptop sleeping. Hive checks them every 30 s, after it starts and when the laptop wakes;
// a row that came due while Hive was closed (or asleep) fires once when it is back and says how late it is.
// A repeating row then moves to its next slot after now: missed slots are not replayed one by one.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDir, TEST_MODE } from './testMode'
import { localIso } from '../shared/watchCore'

export type ThreadWakeup = {
  id: number
  session_id: string
  title: string
  wake_at: string
  prompt: string
  every_minutes: number | null
  status: 'pending' | 'fired' | 'cancelled' | 'failed'
  fired_at: string | null
  error: string | null
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS thread_wakeups (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,               -- the Claude session to wake (resumed when its thread is not open)
  title TEXT NOT NULL DEFAULT '',
  wake_at TEXT NOT NULL,                  -- next wake, ISO local time
  prompt TEXT NOT NULL,                   -- what the thread is asked to do when it wakes
  every_minutes INTEGER,                  -- repeat interval; NULL = once
  status TEXT NOT NULL DEFAULT 'pending', -- pending | fired | cancelled | failed
  fired_at TEXT,                          -- last time it fired
  error TEXT,                             -- why it failed
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
)`

export const MIN_EVERY_MINUTES = 5
// later than this counts as "Hive was closed or the laptop asleep" in the wake message
const LATE_MS = 3 * 60_000

let file = ''
export const wakeupsFile = () => file || process.env.HIVE_WAKEUPS_DB || join(dataDir(), 'hive', 'thread-wakeups.db')
export const setWakeupsFile = (f: string) => { file = f } // tests

function open(): DatabaseSync {
  mkdirSync(dirname(wakeupsFile()), { recursive: true })
  const db = new DatabaseSync(wakeupsFile())
  db.exec(SCHEMA)
  return db
}
function withDb<T>(f: (db: DatabaseSync) => T): T {
  const db = open()
  try { return f(db) } finally { db.close() }
}

export function addWakeup(w: { sessionId: string; title: string; at: Date; prompt: string; everyMinutes?: number }): ThreadWakeup {
  if (!w.sessionId) throw new Error('this thread has no session yet')
  if (!Number.isFinite(w.at.getTime())) throw new Error('invalid wake time')
  if (!w.prompt.trim()) throw new Error('prompt is empty')
  if (w.everyMinutes !== undefined && w.everyMinutes < MIN_EVERY_MINUTES) throw new Error(`every_minutes must be at least ${MIN_EVERY_MINUTES}`)
  return withDb((db) => {
    const r = db.prepare('INSERT INTO thread_wakeups (session_id, title, wake_at, prompt, every_minutes) VALUES (?, ?, ?, ?, ?)')
      .run(w.sessionId, w.title, localIso(w.at), w.prompt, w.everyMinutes ?? null)
    return db.prepare('SELECT * FROM thread_wakeups WHERE id = ?').get(Number(r.lastInsertRowid)) as ThreadWakeup
  })
}

// pending rows, soonest first; one session's when given
export const listWakeups = (sessionId?: string): ThreadWakeup[] => withDb((db) =>
  (db.prepare(`SELECT * FROM thread_wakeups WHERE status = 'pending' ${sessionId ? 'AND session_id = ?' : ''}`)
    .all(...(sessionId ? [sessionId] : [])) as ThreadWakeup[]).sort((a, b) => Date.parse(a.wake_at) - Date.parse(b.wake_at)))

// only the session that made it (or anyone when sessionId is omitted: the user)
export const cancelWakeup = (id: number, sessionId?: string): boolean => withDb((db) =>
  Number(db.prepare(`UPDATE thread_wakeups SET status = 'cancelled' WHERE id = ? AND status = 'pending' ${sessionId ? 'AND session_id = ?' : ''}`)
    .run(...(sessionId ? [id, sessionId] : [id])).changes) > 0)

export const dueWakeups = (now: number): ThreadWakeup[] => listWakeups().filter((r) => Date.parse(r.wake_at) <= now)

// the first slot of a repeating wake-up after now
export function nextSlot(wakeAt: number, everyMinutes: number, now: number): number {
  const step = everyMinutes * 60_000
  return wakeAt + (Math.floor((now - wakeAt) / step) + 1) * step
}

export function wakeMessage(r: ThreadWakeup, now: number): string {
  const late = now - Date.parse(r.wake_at)
  const lines = [`[Scheduled wake-up #${r.id}, due ${r.wake_at}${r.every_minutes ? `, repeats every ${r.every_minutes} min` : ''}]`]
  if (late > LATE_MS) lines.push(`This is ${Math.round(late / 60_000)} min late: Hive was closed or the laptop was asleep. Catch up on whatever you missed.`)
  lines.push('', r.prompt)
  return lines.join('\n')
}

function markFired(r: ThreadWakeup, now: number): void {
  withDb((db) => {
    if (r.every_minutes) db.prepare('UPDATE thread_wakeups SET wake_at = ?, fired_at = ?, error = NULL WHERE id = ?').run(localIso(new Date(nextSlot(Date.parse(r.wake_at), r.every_minutes, now))), localIso(new Date(now)), r.id)
    else db.prepare(`UPDATE thread_wakeups SET status = 'fired', fired_at = ?, error = NULL WHERE id = ?`).run(localIso(new Date(now)), r.id)
  })
}
const markFailed = (r: ThreadWakeup, error: string) => withDb((db) => db.prepare(`UPDATE thread_wakeups SET status = 'failed', error = ? WHERE id = ?`).run(error, r.id))

// deliver: resumes or messages the thread; throws "No thread or session" when the session is gone (the row fails),
// anything else (the window not ready yet) leaves it pending for the next check
type Deliver = (sessionId: string, text: string) => Promise<unknown>
let deliver: Deliver | null = null
let ticking = false

export async function tick(now = Date.now()): Promise<number> {
  if (!deliver || ticking) return 0
  ticking = true
  let fired = 0
  try {
    for (const r of dueWakeups(now)) {
      try {
        await deliver(r.session_id, wakeMessage(r, now))
        markFired(r, now)
        fired++
      } catch (e) {
        const m = (e as Error).message ?? String(e)
        if (/No thread or session/.test(m)) markFailed(r, m)
      }
    }
  } catch { /* the table is busy: next check */ } finally {
    ticking = false
  }
  return fired
}

export function initThreadWakeups(d: Deliver, opts: { auto?: boolean } = {}) {
  deliver = d
  if (TEST_MODE || opts.auto === false) return
  setTimeout(() => void tick(), 60_000).unref() // after the window has loaded (a reload stops every live thread)
  setInterval(() => void tick(), 30_000).unref()
}

export function formatWakeups(rows: ThreadWakeup[]): string {
  if (!rows.length) return 'No pending wake-ups.'
  return rows.map((r) => `#${r.id}  ${r.wake_at}${r.every_minutes ? `  every ${r.every_minutes} min` : ''}  ${r.prompt.split('\n')[0].slice(0, 120)}`).join('\n')
}
