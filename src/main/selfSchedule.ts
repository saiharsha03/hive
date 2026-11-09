// Self-scheduled watchers (schedule every "self"): the watcher plans its own wake-ups in a SQLite table in its folder
// and manages it (status, results, extra columns). Hive only reads it: it wakes the watcher when a pending row comes
// due, marks those rows woken, and wakes it once after FALLBACK_MS when nothing is pending, so it never stays asleep.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

export const SCHEDULE_DB = 'schedule.db'
export const FALLBACK_MS = 6 * 3_600_000

export type Wakeup = { id: number; wake_at: string; purpose: string | null }

const SCHEMA = `CREATE TABLE IF NOT EXISTS wakeups (
  id INTEGER PRIMARY KEY,
  wake_at TEXT NOT NULL,                  -- when to wake, ISO local time, e.g. 2026-11-02T08:00:00
  purpose TEXT,                           -- why you want to wake then
  status TEXT NOT NULL DEFAULT 'pending', -- pending | woken (set by Hive) | done | failed | skipped
  woken_at TEXT,                          -- when Hive woke you for this row
  finished_at TEXT,
  result TEXT,                            -- what the run did
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
)`

export const scheduleFile = (dir: string) => join(dir, SCHEDULE_DB)

function open(dir: string): DatabaseSync {
  const db = new DatabaseSync(scheduleFile(dir))
  db.exec(SCHEMA)
  return db
}

// pending rows due by now (oldest first) and the next pending wake-up after now
export function readWakeups(dir: string, now: number): { due: Wakeup[]; next: number | null } {
  const db = open(dir)
  try {
    const rows = db.prepare(`SELECT id, wake_at, purpose FROM wakeups WHERE status = 'pending'`).all() as Wakeup[]
    const at = (r: Wakeup) => Date.parse(r.wake_at)
    const valid = rows.filter((r) => Number.isFinite(at(r))).sort((a, b) => at(a) - at(b))
    return { due: valid.filter((r) => at(r) <= now), next: valid.map(at).find((t) => t > now) ?? null }
  } finally {
    db.close()
  }
}

export function markWoken(dir: string, ids: number[], wokenAt: string): void {
  if (!ids.length) return
  const db = open(dir)
  try {
    const st = db.prepare(`UPDATE wakeups SET status = 'woken', woken_at = ? WHERE id = ?`)
    for (const id of ids) st.run(wokenAt, id)
  } finally {
    db.close()
  }
}
