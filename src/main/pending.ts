// Messages sent while Claude was working (steered or queued) are kept in ~/.orbit/hive-pending.json until they reach
// Claude, so closing Orbit by mistake loses none of them: on the next start they are sent again to the same thread.
// A message has reached Claude when the CLI echoes it back (its uuid, chat.ts hive_seen); the end of the turn it rode
// is the fallback for an engine that sends no echo. A queued message handed over to the engine rides the next turn.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSafe } from './safeWrite'
import { dataDir } from './testMode'

// uuid: the message's own id, which the CLI's echo carries when Claude takes it in
export type Pending = { key: string; uuid?: string; tabId: string; cwd: string; sessionId: string | null; title: string; text: string; images?: string[]; mode: 'steer' | 'queue'; background?: boolean; at: number }
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
// what goes again after a restart: per thread, all its messages as one prompt (one turn), so that turn's result clears
// exactly the messages it delivered. Order kept; each with its pictures as files.
export function resendGroups(all: Pending[]): (Pending & { prompt: string; keys: string[] })[] {
  const by = new Map<string, Pending[]>()
  for (const p of all) by.set(p.tabId, [...(by.get(p.tabId) ?? []), p])
  return [...by.values()].map((ps) => ({ ...ps[0], prompt: ps.map(resendText).join('\n\n---\n\n'), keys: ps.map((p) => p.key) }))
}
// the messages of one resent prompt are seen when that prompt is: it goes in under this uuid
export function pendingResent(keys: string[], uuid: string): void {
  const all = read()
  if (all.some((p) => keys.includes(p.key))) write(all.map((p) => (keys.includes(p.key) ? { ...p, uuid } : p)))
}
// the text sent again after a restart: the pictures as files Claude can open
export const resendText = (p: Pending) => (p.images?.length ? `${p.text}${p.text ? '\n\n' : ''}(Attached images, saved when Orbit closed: ${p.images.join(', ')})` : p.text)
export const pendingDelivered = (key: string) => drop((p) => p.key !== key)
// Claude took this message in (the CLI's echo of it): quitting now must not send it again
export const pendingSeen = (uuid: string) => drop((p) => p.uuid !== uuid)
// "At next step" on a queued message (or Ctrl+Shift+Enter sending all that waits): it now rides the running turn, so it goes when that turn ends (like any steer)
export function pendingIsSteer(key: string): void {
  const all = read()
  if (all.some((p) => p.key === key && p.mode !== 'steer')) write(all.map((p) => (p.key === key ? { ...p, mode: 'steer' as const } : p)))
}
export const steersDelivered = (tabId: string) => drop((p) => !(p.tabId === tabId && p.mode === 'steer'))
export const threadClosed = (tabId: string) => drop((p) => p.tabId !== tabId) // closed on purpose: its unsent messages go too
// the thread's process ended by itself with these still unsent: they went back to the window's message box instead
export const pendingReturned = (tabId: string) => threadClosed(tabId)
// a new thread learns its Claude session id after its first message: its pending messages can then resume it
export function pendingSession(tabId: string, sessionId: string): void {
  const all = read()
  if (all.some((p) => p.tabId === tabId && p.sessionId !== sessionId)) write(all.map((p) => (p.tabId === tabId ? { ...p, sessionId } : p)))
}
// everything left from the last run, oldest first, to send again. They stay on disk, now as steers of their thread, so
// they go only when that thread's turn ends: Orbit closing again before then loses none of them.
export function takePending(): Pending[] {
  const all = read()
  if (all.some((p) => p.mode !== 'steer')) write(all.map((p) => ({ ...p, mode: 'steer' as const })))
  return all.sort((a, b) => a.at - b.at)
}
