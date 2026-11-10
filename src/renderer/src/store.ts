// The window's thread state, outside React: every open thread (Session) and the panes that show them. Each region
// subscribes with a selector and an equality test, so a streaming reply in one thread re-renders only the pane
// that shows it; the rail, the inspector, the tab row and the other panes see nothing change.
// The main process owns the threads; this is what the window has been told about them.
import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { Session } from './chat'
import { emptyPanes, type PaneState } from './panes'

type Listener = () => void
export type Store<T> = { get: () => T; set: (v: T | ((cur: T) => T)) => void; subscribe: (l: Listener) => () => void }

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<Listener>()
  return {
    get: () => value,
    set: (v) => {
      const next = typeof v === 'function' ? (v as (cur: T) => T)(value) : v
      if (Object.is(next, value)) return
      value = next
      listeners.forEach((l) => l())
    },
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l) } },
  }
}

// a selected value that keeps its identity while eq says it is unchanged
export function useStore<T, S>(store: Store<T>, sel: (v: T) => S, eq: (a: S, b: S) => boolean = Object.is): S {
  const last = useRef<{ src: T; out: S } | null>(null)
  const selRef = useRef(sel)
  selRef.current = sel
  const get = useCallback(() => {
    const src = store.get()
    const prev = last.current
    if (prev && prev.src === src) return prev.out
    const out = selRef.current(src)
    if (prev && eq(prev.out, out)) { last.current = { src, out: prev.out }; return prev.out }
    last.current = { src, out }
    return out
  }, [store, eq])
  return useSyncExternalStore(store.subscribe, get)
}

export const shallowEq = (a: any, b: any): boolean => {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => Object.is(a[k], b[k]))
}
export const listEq = <T>(eq: (a: T, b: T) => boolean = Object.is) => (a: T[], b: T[]): boolean => a.length === b.length && a.every((x, i) => eq(x, b[i]))
export const jsonEq = (a: unknown, b: unknown): boolean => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)

// ---- sessions ----
export const sessions = createStore<Session[]>([])
export const getSessions = sessions.get
export const setSessions = sessions.set

// one thread, re-rendered only when that thread changes
export const useSession = (id: string | null | undefined): Session | undefined =>
  useStore(sessions, useCallback((all: Session[]) => (id ? all.find((s) => s.id === id) : undefined), [id]))

// what the shell needs of every thread: no items, no streaming text
export type SessionMeta = Pick<Session, 'id' | 'title' | 'cwd' | 'sessionId' | 'path' | 'busy' | 'background' | 'waitingReason' | 'waitingSince' | 'file' | 'tool' | 'worktrees' | 'mode' | 'compactions' | 'loaded' | 'endedRun' | 'compacting'>
const metaCache = new WeakMap<Session, SessionMeta>()
export function metaOf(s: Session): SessionMeta {
  let m = metaCache.get(s)
  if (!m) {
    m = { id: s.id, title: s.title, cwd: s.cwd, sessionId: s.sessionId, path: s.path, busy: s.busy, background: s.background, waitingReason: s.waitingReason, waitingSince: s.waitingSince,
      file: s.file, tool: s.tool, worktrees: s.worktrees, mode: s.mode, compactions: s.compactions, loaded: s.loaded, endedRun: s.endedRun, compacting: s.compacting }
    metaCache.set(s, m)
  }
  return m
}
const metaListEq = listEq<SessionMeta>(shallowEq)
const allMeta = (all: Session[]) => all.map(metaOf)
export const useSessionMetas = (): SessionMeta[] => useStore(sessions, allMeta, metaListEq)

// ---- panes ----
export const panes = createStore<PaneState>(emptyPanes())
export const usePanes = (): PaneState => useStore(panes, (p) => p)
