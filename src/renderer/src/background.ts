// Background sessions: pure logic for what a live session is doing (working / waiting for the user) and the sidebar rows built from it.
import { applyEvent, toolLine, type Session } from './chat'
import { isWatcherTab } from '../../shared/readOnlyCore'
import { nowLine } from './conversationCore'

export type LiveState = 'working' | 'waiting' | null
// kind 'deploy' / 'dev' / 'script' are the Deploy wizard's, Dev stack's and Scripts' items (not Claude sessions)
export type LiveRow = { id: string; kind?: 'deploy' | 'script'; sessionId?: string; title: string; state: 'working' | 'waiting'; note: string; since: number }

// waiting (Claude asked, or a background turn ended) wins over working; the visible active tab never carries waiting
export const stateOf = (s: Session): LiveState => (s.waitingSince ? 'waiting' : s.busy ? 'working' : null)

// opening or activating a session shows its tab and clears waiting
export const activateSession = (all: Session[], id: string): Session[] =>
  all.map((s) => (s.id === id ? { ...s, background: false, waitingReason: undefined, waitingSince: undefined } : s))

// the live session for a saved-session id: a tab with that id, or a new tab whose Claude session got that id
export const findSession = (all: Session[], id: string) => all.find((s) => s.id === id || s.sessionId === id)

// Claude's own "waiting" call; ignored while that tab is the one on screen
export function markWaiting(s: Session, reason: string | undefined, now: number, shown: boolean): Session {
  if (shown) return s
  return { ...s, waitingReason: reason?.trim() || 'Needs your input', waitingSince: now }
}

const firstLine = (t: string) => (t.split('\n').map((l) => l.replace(/^[#>*\-\s`]+/, '').trim()).find(Boolean) ?? '')

// an event for one session; a background turn that ends while the tab is not on screen leaves it waiting for the user
export function onSessionEvent(s: Session, ev: any, activeId: string | null, now: number): Session {
  const next = applyEvent(s, ev)
  if (!s.busy || next.busy || !s.background || activeId === s.id || next.waitingSince) return next
  if (ev.type !== 'result' && ev.type !== 'hive_error') return next
  const last = next.items.at(-1)
  if (last?.kind === 'error') return { ...next, waitingReason: `Failed: ${firstLine(last.text)}`, waitingSince: now }
  // a Watch run only waits for the user when it says so (organize_thread waiting), not every time a scheduled run ends
  if (isWatcherTab(s.id)) return next
  const reply = [...next.items].reverse().find((i) => i.kind === 'assistant')
  const line = reply?.kind === 'assistant' ? firstLine(reply.text) : ''
  return { ...next, waitingReason: line ? `Finished: ${line}` : 'Finished', waitingSince: now }
}

// the latest running tool, as "Ran npm test"
export function activity(s: Session): string {
  const t = [...s.items].reverse().find((i) => i.kind === 'tool' && i.status === 'running')
  if (t?.kind !== 'tool') return 'Working'
  const { verb, what } = toolLine(t.name, t.input)
  return nowLine(verb, what, t.input)
}

// agents: per tab, how many of its subagents / workflows / Codex runs are still running. A thread whose turn ended
// but which still has some running is working (waiting on them), not idle or "Finished"; a question for the user wins.
export function liveRows(all: Session[], extra: LiveRow[] = [], agents: Map<string, number> = new Map()): { waiting: LiveRow[]; working: LiveRow[] } {
  const rows: LiveRow[] = [...extra]
  for (const s of all) {
    let state = stateOf(s)
    const n = agents.get(s.id) ?? 0
    const onAgents = n > 0 && !s.busy && (!state || (s.waitingReason ?? '').startsWith('Finished'))
    if (onAgents) state = 'working'
    if (!state) continue
    const note = onAgents ? `Waiting on ${n} agent${n === 1 ? '' : 's'}` : state === 'waiting' ? s.waitingReason ?? '' : activity(s)
    rows.push({ id: s.id, sessionId: s.sessionId, title: s.title, state, note, since: s.waitingSince ?? 0 })
  }
  return {
    waiting: rows.filter((r) => r.state === 'waiting').sort((a, b) => a.since - b.since),
    working: rows.filter((r) => r.state === 'working'),
  }
}
