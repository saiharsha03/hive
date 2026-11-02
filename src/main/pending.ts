// Messages sent while Claude was working (steered or queued) are kept in ~/.claude/hive-pending.json until they reach
// Claude, so closing Hive by mistake loses none of them: on the next start they are sent again to the same thread.
// A queued message reaches Claude when the queue hands it over; a steered one when that turn ends.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSafe } from './safeWrite'
import { dataDir } from './testMode'

export type Pending = { key: string; tabId: string; cwd: string; sessionId: string | null; title: string; text: string; images?: string[]; mode: 'steer' | 'queue'; background?: boolean; at: number }
export type Picture = { mediaType: string; data: string }

const file = () => join(dataDir(), 'hive-pending.json')
function read(): Pending[] { try { const v = JSON.parse(readFileSync(file(), 'utf8')); return Array.isArray(v) ? v : [] } catch { return [] } }
const write = (all: Pending[]) => writeFileSafe(file(), JSON.stringify(all))

// pictures go to their own files (too big for the JSON); a resent message points Claude at them
const picDir = () => join(dataDir(), 'hive-pending')
export function addPending(p: Omit<Pending, 'key' | 'at' | 'images'> & { key?: string; pictures?: Picture[] }): void {
  const { pictures = [], ...rest } = p
  const key = p.key ?? randomUUID()
  const images = pictures.map((pic, i) => {
    mkdirSync(picDir(), { recursive: true })
    const path = join(picDir(), `${key}-${i}.${pic.mediaType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'}`)
    writeFileSync(path, Buffer.from(pic.data, 'base64'))
    return path
  })
  write([...read(), { ...rest, key, ...(images.length ? { images } : {}), at: Date.now() }])
}
// a message that reached Claude no longer needs its picture files
const drop = (keep: (p: Pending) => boolean) => {
  const all = read(); const next = all.filter(keep)
  if (next.length === all.length) return
  for (const p of all) if (!keep(p)) for (const f of p.images ?? []) rmSync(f, { force: true })
  write(next)
}
// the text sent again after a restart: the pictures as files Claude can open
export const resendText = (p: Pending) => (p.images?.length ? `${p.text}${p.text ? '\n\n' : ''}(Attached images, saved when Hive closed: ${p.images.join(', ')})` : p.text)
export const pendingDelivered = (key: string) => drop((p) => p.key !== key)
export const steersDelivered = (tabId: string) => drop((p) => !(p.tabId === tabId && p.mode === 'steer'))
export const threadClosed = (tabId: string) => drop((p) => p.tabId !== tabId) // closed on purpose: its unsent messages go too
// a new thread learns its Claude session id after its first message: its pending messages can then resume it
export function pendingSession(tabId: string, sessionId: string): void {
  const all = read()
  if (all.some((p) => p.tabId === tabId && p.sessionId !== sessionId)) write(all.map((p) => (p.tabId === tabId ? { ...p, sessionId } : p)))
}
// everything left from the last run, oldest first, to send again. They stay on disk, now as steers of their thread, so
// they go only when that thread's turn ends: Hive closing again before then loses none of them.
export function takePending(): Pending[] {
  const all = read()
  if (all.some((p) => p.mode !== 'steer')) write(all.map((p) => ({ ...p, mode: 'steer' as const })))
  return all.sort((a, b) => a.at - b.at)
}
