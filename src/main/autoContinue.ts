// Threads waiting for a usage limit to reset: each wakes a minute after its reset (spaced a few minutes apart) with
// "Continue where you left off". Saved in hive-autocontinue.json, so a Hive restart keeps them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSafe } from './safeWrite'
import { dataDir } from './testMode'
import { CONTINUE_PROMPT, catchUp, planWake, type Wake } from '../shared/continueCore'

const file = () => join(dataDir(), 'hive-autocontinue.json')
let wakes: Wake[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
// fire: send the prompt to the thread; false = not possible now (no window yet), tried again in a minute
type Deps = { fire: (w: Wake, prompt: string) => Promise<boolean>; changed: (w: Wake, at: number | null) => void }
let deps: Deps | null = null

const save = () => { try { writeFileSafe(file(), JSON.stringify(wakes, null, 2)) } catch { /* kept in memory */ } }
const valid = (w: any): w is Wake => w && typeof w.key === 'string' && typeof w.tabId === 'string' && typeof w.cwd === 'string' && typeof w.title === 'string' && Number.isFinite(w.at)

function arm(w: Wake): void {
  clearTimeout(timers.get(w.key))
  // setTimeout holds at most ~24.8 days; a later wake re-arms on the way
  const ms = Math.min(Math.max(0, w.at - Date.now()), 2 ** 31 - 1)
  timers.set(w.key, setTimeout(() => void due(w.key), ms))
}

async function due(key: string): Promise<void> {
  const w = wakes.find((x) => x.key === key)
  if (!w || !deps) return
  if (w.at > Date.now() + 1000) return arm(w)
  const ok = await deps.fire(w, CONTINUE_PROMPT).catch(() => false)
  if (!ok) { w.at = Date.now() + 60_000; save(); return arm(w) }
  drop(key)
}

function drop(key: string): void {
  const w = wakes.find((x) => x.key === key)
  clearTimeout(timers.get(key)); timers.delete(key)
  wakes = wakes.filter((x) => x.key !== key)
  save()
  if (w) deps?.changed(w, null)
}

export function initAutoContinue(d: Deps): void {
  deps = d
  try { const v = JSON.parse(readFileSync(file(), 'utf8')); wakes = Array.isArray(v) ? v.filter(valid) : [] } catch { wakes = [] }
  wakes = catchUp(wakes, Date.now())
  save()
  wakes.forEach(arm)
}

// a thread hit the limit: when it wakes (one wake per thread; a later hit replaces it)
export function scheduleContinue(t: Omit<Wake, 'at'>, resetAt: number): Wake {
  const others = wakes.filter((x) => x.key !== t.key).map((x) => x.at)
  const w: Wake = { ...t, at: planWake(resetAt, others, Date.now()) }
  wakes = [...wakes.filter((x) => x.key !== t.key), w]
  save()
  arm(w)
  deps?.changed(w, w.at)
  return w
}

// by session id or tab id: Cancel in the thread, or the user wrote to it themselves
export function cancelContinue(id: string): boolean {
  const w = wakes.find((x) => x.key === id || x.tabId === id)
  if (!w) return false
  drop(w.key)
  return true
}

export const continueAt = (id: string): number | null => wakes.find((x) => x.key === id || x.tabId === id)?.at ?? null
