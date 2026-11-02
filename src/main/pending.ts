// Messages sent while Claude was working (steered or queued) are kept in ~/.claude/hive-pending.json until they reach
// Claude, so closing Hive by mistake loses none of them: on the next start they are sent again to the same thread.
// A queued message reaches Claude when the queue hands it over; a steered one when that turn ends.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSafe } from './safeWrite'
import { dataDir } from './testMode'

export type Pending = { key: string; tabId: string; cwd: string; sessionId: string | null; title: string; text: string; mode: 'steer' | 'queue'; at: number }

const file = () => join(dataDir(), 'hive-pending.json')
function read(): Pending[] { try { const v = JSON.parse(readFileSync(file(), 'utf8')); return Array.isArray(v) ? v : [] } catch { return [] } }
const write = (all: Pending[]) => writeFileSafe(file(), JSON.stringify(all))

export function addPending(p: Omit<Pending, 'key' | 'at'> & { key?: string }): void {
  write([...read(), { ...p, key: p.key ?? randomUUID(), at: Date.now() }])
}
const drop = (keep: (p: Pending) => boolean) => { const all = read(); const next = all.filter(keep); if (next.length !== all.length) write(next) }
export const pendingDelivered = (key: string) => drop((p) => p.key !== key)
export const steersDelivered = (tabId: string) => drop((p) => !(p.tabId === tabId && p.mode === 'steer'))
export const threadClosed = (tabId: string) => drop((p) => p.tabId !== tabId) // closed on purpose: its unsent messages go too
// a new thread learns its Claude session id after its first message: its pending messages can then resume it
export function pendingSession(tabId: string, sessionId: string): void {
  const all = read()
  if (all.some((p) => p.tabId === tabId && p.sessionId !== sessionId)) write(all.map((p) => (p.tabId === tabId ? { ...p, sessionId } : p)))
}
// everything left from the last run, oldest first, and the file emptied
export function takePending(): Pending[] {
  const all = read()
  if (all.length) write([])
  return all.sort((a, b) => a.at - b.at)
}
