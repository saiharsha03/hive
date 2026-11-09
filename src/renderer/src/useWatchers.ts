// One shared source for every place that shows watchers (the Watchers view, a top-bar toggle list, a sidebar list):
// a single poll plus main's "watchers:changed" push, so a switch flipped in one place shows everywhere at once.
// setEnabled behaves the same from anywhere: off ends the watcher's session, on starts a fresh one.
import { useSyncExternalStore } from 'react'
import type { WatcherStatus, WatcherSummary, WatchersList } from '../../shared/watchersCore'

export type WatcherRow = WatcherSummary & { state: WatcherStatus; waiting: boolean }
export type WatchersSnapshot = { list: WatchersList | null; watchers: WatcherRow[]; error: string; busy: Record<string, boolean> }

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

let snap: WatchersSnapshot = { list: null, watchers: [], error: '', busy: {} }
const subs = new Set<() => void>()
const emit = (next: Partial<WatchersSnapshot>) => { snap = { ...snap, ...next }; for (const f of subs) f() }
let stop: (() => void) | null = null

export async function reloadWatchers(): Promise<void> {
  try {
    const list = await window.api.watchersList()
    emit({ list, watchers: list.watchers.map((w) => ({ ...w, state: w.status, waiting: w.status === 'waiting' })), error: '' })
  } catch (e) {
    emit({ error: clean(e) })
  }
}

function subscribe(f: () => void) {
  subs.add(f)
  if (!stop) {
    void reloadWatchers()
    const t = setInterval(() => void reloadWatchers(), 10_000)
    const off = window.api.onWatchersChanged(() => void reloadWatchers())
    stop = () => { clearInterval(t); off() }
  }
  return () => {
    subs.delete(f)
    if (!subs.size && stop) { stop(); stop = null }
  }
}

async function act(id: string, fn: () => Promise<string | unknown>): Promise<string> {
  emit({ busy: { ...snap.busy, [id]: true } })
  try {
    const r = await fn()
    const msg = typeof r === 'string' ? r : ''
    if (msg) emit({ error: msg })
    return msg
  } catch (e) {
    const msg = clean(e)
    emit({ error: msg })
    return msg
  } finally {
    const { [id]: _, ...rest } = snap.busy
    emit({ busy: rest })
    await reloadWatchers()
  }
}

export const setWatcherEnabled = (id: string, on: boolean) => act(id, () => window.api.watcherEnable(id, on))
export const runWatcher = (id: string, kind: 'sweep' | 'daily' | 'weekly' = 'sweep') => act(id, () => window.api.watcherRun(id, kind))

export function useWatchers() {
  const s = useSyncExternalStore(subscribe, () => snap)
  return { ...s, reload: reloadWatchers, setEnabled: setWatcherEnabled, runNow: runWatcher }
}
