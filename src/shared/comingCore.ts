// What is coming up for one thread: its loops, its wake-ups and a pending automatic continue. One assembly for the
// thread header and the Activity panel. Pure, so it can be tested without the DOM.
import { describeCron, nextRun } from './cronCore'

export type ComingKind = 'loop' | 'wake' | 'continue'
export type Coming = {
  key: string; kind: ComingKind; at: number | null
  what: string // the prompt it runs
  how: string // its schedule in words
  id?: number | string // the wake-up's or continue's id, when it can be cancelled
  own?: boolean // the thread's own wake-up (it set it itself; the app cannot cancel it)
}
export type ComingInput = {
  tabId: string; sessionId?: string | null
  crons: { id: string; schedule: string; recurring: boolean; prompt: string }[]
  nextWake: number | null
  wakeups: { id: number; sessionId: string; wakeAt: string; prompt: string; everyMinutes: number | null; firedAt: string | null }[]
  continues: { key: string; tabId: string; at: number }[]
}

// nearest first; an item with no next time (a schedule that cannot be read) goes last
export function comingUp(i: ComingInput, now: number): Coming[] {
  const rows: Coming[] = []
  for (const j of i.crons) rows.push({ key: `loop:${j.id}`, kind: 'loop', at: nextRun(j.schedule, new Date(now))?.getTime() ?? null, what: j.prompt, how: describeCron(j.schedule) })
  for (const w of i.wakeups) {
    const at = Date.parse(w.wakeAt)
    if (w.firedAt || !i.sessionId || w.sessionId !== i.sessionId || !Number.isFinite(at)) continue
    rows.push({ key: `wake:${w.id}`, kind: 'wake', at, what: w.prompt, how: w.everyMinutes ? `every ${w.everyMinutes} min` : 'once', id: w.id })
  }
  if (i.nextWake && i.nextWake > now) rows.push({ key: 'wake:own', kind: 'wake', at: i.nextWake, what: 'Its own wake-up, set by the thread', how: 'once', own: true })
  for (const c of i.continues) if (c.tabId === i.tabId || (!!i.sessionId && c.key === i.sessionId)) rows.push({ key: `continue:${c.key}`, kind: 'continue', at: c.at, what: 'Continues after the usage limit resets', how: 'once', id: c.key })
  return rows.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
}

export const KIND_WORD: Record<ComingKind, string> = { loop: 'Loop', wake: 'Wake-up', continue: 'Automatic continue' }
const WORDS: Record<ComingKind, [string, string]> = { loop: ['loop', 'loops'], wake: ['wake-up', 'wake-ups'], continue: ['automatic continue', 'automatic continues'] }
// within this the time is said as "in 12 min" and the label ticks; further out it is a clock time
export const SOON_MS = 15 * 60_000
const hm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
// "in 12 min", "14:30", "Thu 09:00" when it is not today
export function whenWord(at: number, now: number): string {
  const d = at - now
  if (d < 60_000) return d > -60_000 ? 'in under a minute' : 'due'
  if (d < SOON_MS) return `in ${Math.round(d / 60_000)} min`
  return new Date(at).toDateString() === new Date(now).toDateString() ? hm(at) : `${new Date(at).toLocaleDateString('en-GB', { weekday: 'short' })} ${hm(at)}`
}
export const nearest = (rows: Coming[]): number | null => rows.find((r) => r.at !== null)?.at ?? null
// "1 loop, next 14:30", "2 wake-ups, next in 12 min", "1 loop and 1 wake-up, next 14:30"
export function comingLabel(rows: Coming[], now: number): string {
  const parts = (['loop', 'wake', 'continue'] as ComingKind[]).map((k) => { const n = rows.filter((r) => r.kind === k).length; return n ? `${n} ${WORDS[k][n === 1 ? 0 : 1]}` : '' }).filter(Boolean)
  if (!parts.length) return ''
  const at = nearest(rows)
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}${at !== null ? `, next ${whenWord(at, now)}` : ''}`
}
