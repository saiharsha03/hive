// Per-tab live status (model, effort, goal, loop jobs, background work), kept beside the chat state:
// it listens to the same chat events on its own, so the conversation code stays as it is.
import { useSyncExternalStore } from 'react'
import { emptyStatus, reduceStatus, type ThreadStatus } from '../../shared/statusCore'

const EMPTY = emptyStatus()
const store = new Map<string, ThreadStatus>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

let listening = false
function listen() {
  if (listening) return
  listening = true
  window.api.onChatEvent((tabId, ev) => {
    const cur = store.get(tabId) ?? EMPTY
    const next = reduceStatus(cur, ev, Date.now())
    if (next !== cur) { store.set(tabId, next); notify() }
  })
}
listen()

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }

export function useThreadStatus(tabId: string | null | undefined): ThreadStatus {
  return useSyncExternalStore(subscribe, () => (tabId ? store.get(tabId) : undefined) ?? EMPTY)
}

function patch(tabId: string, fn: (s: ThreadStatus) => ThreadStatus) {
  store.set(tabId, fn(store.get(tabId) ?? EMPTY))
  notify()
}

// the tab was closed: its status goes with it
export function forgetStatus(tabId: string) { if (store.delete(tabId)) notify() }
// hide a met goal
export const dismissGoal = (tabId: string) => patch(tabId, (s) => ({ ...s, goal: null }))

// every tab's status at once (the Agents view); a new Map object after every change
let all = new Map<string, ThreadStatus>()
listeners.add(() => { all = new Map(store) })
export function useAllStatus(): Map<string, ThreadStatus> {
  return useSyncExternalStore(subscribe, () => all)
}
export const getAllStatus = (): Map<string, ThreadStatus> => all
export const onStatusChange = subscribe
// one tab's status outside React
export const getStatusOf = (tabId: string): ThreadStatus => store.get(tabId) ?? EMPTY

// a model or effort picked in the page shows at once, before the session runs (main only reports it once there is one)
export const setPicked = (tabId: string, v: { model?: string; effort?: string; advisorPick?: string; advisor?: string | null }) => patch(tabId, (s) => ({ ...s, ...v }))
