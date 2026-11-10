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
// what the list could not load, and what the last switch / run said: kept apart, so a reload after a failed action
// does not wipe the reason it failed
let loadError = ''
let actionError = ''
const errorNow = () => actionError || loadError
let lastList = ''

export async function reloadWatchers(): Promise<void> {
  try {
    const list = await window.api.watchersList()
    loadError = ''
    // the poll answers every 10 s: the same answer keeps the same objects, so nothing that reads them re-renders
    const json = JSON.stringify(list)
    if (json === lastList) { if (snap.error !== errorNow()) emit({ error: errorNow() }); return }
    lastList = json
    emit({ list, watchers: list.watchers.map((w) => ({ ...w, state: w.status, waiting: w.status === 'waiting' })), error: errorNow() })
  } catch (e) {
    loadError = clean(e)
    emit({ error: errorNow() })
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
  actionError = ''
  emit({ busy: { ...snap.busy, [id]: true }, error: errorNow() })
  try {
    const r = await fn()
    const msg = typeof r === 'string' ? r : ''
    actionError = msg
    if (msg) emit({ error: errorNow() })
    return msg
  } catch (e) {
    const msg = clean(e)
    actionError = msg
    emit({ error: errorNow() })
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
