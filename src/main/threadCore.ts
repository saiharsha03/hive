// Pure decisions about a live thread's process (no Electron, no SDK, no I/O), so they can be tested: when an ended
// team's thread may close, when an idle process may be closed (the next message resumes the session), which settings
// class a thread is in, and the memory folder threads under the workspace share.
import { join, posix, win32 } from 'node:path'

// What a thread still has going. Anything here keeps its process: closing it would kill that work or lose a message.
export type Activity = {
  busy: boolean // a turn is running or about to
  queued: number // messages waiting in the turn queue
  unseen: number // messages handed to the engine that Claude has not taken in yet
  tasks: string[] // running background work: subagents, workflows, shells, monitors
  stopTasks: number // background tasks the last Stop hook still reported in flight
  codex: number // Codex runs of this thread
  crons: number // session crons and /loop jobs (they die with the process)
  wake: boolean // a ScheduleWakeup is pending or running
  goal: boolean // a /goal not met yet
  asks: number // open AskUserQuestion cards
  rewind: boolean // a rewind is in flight or its fork waits for the next message
}

export function busyWith(a: Activity): string[] {
  const out: string[] = []
  if (a.busy) out.push('a turn')
  if (a.queued) out.push(`${a.queued} queued message${a.queued > 1 ? 's' : ''}`)
  if (a.unseen) out.push('a message Claude has not read yet')
  if (a.tasks.length) out.push(...a.tasks)
  else if (a.stopTasks) out.push(`${a.stopTasks} background task${a.stopTasks > 1 ? 's' : ''}`)
  if (a.codex) out.push(`${a.codex} Codex run${a.codex > 1 ? 's' : ''}`)
  if (a.crons) out.push(`${a.crons} scheduled loop${a.crons > 1 ? 's' : ''}`)
  if (a.wake) out.push('a scheduled wake-up')
  if (a.goal) out.push('a goal')
  if (a.asks) out.push('an open question')
  if (a.rewind) out.push('a rewind')
  return out
}

// An ended team's thread closes once nothing of it runs. Until the deadline it waits; at the deadline, anything still
// running (a background shell included) keeps the thread open, marked waiting, instead of closing it under that work.
export function retireStep(a: Activity, waitedMs: number, deadlineMs: number): { act: 'close' } | { act: 'wait' } | { act: 'keep'; why: string } {
  const left = busyWith(a)
  if (!left.length) return { act: 'close' }
  if (waitedMs < deadlineMs) return { act: 'wait' }
  return { act: 'keep', why: `The team ended, but this thread still has ${left.join(', ')} running, so it was left open` }
}

// An idle thread's process (Settings > General, minutes; 0 = never) closes once nothing runs and nothing waits: the tab
// and its session stay, and the next message resumes the session like a thread whose process ended by itself.
export function idleToClose(a: Activity, idleForMs: number, limitMs: number): boolean {
  return limitMs > 0 && idleForMs >= limitMs && busyWith(a).length === 0
}

// Which defaults a thread starts with (Settings > General): the main ones for the user's own threads, the team ones for
// teammates and a team's own Lead, the background ones for watcher runs and Dependabot reviews
export type ThreadClass = 'main' | 'team' | 'background'
export function threadClass(tabId: string, watcher: boolean): ThreadClass {
  if (watcher || tabId.startsWith('watcher-') || tabId.startsWith('dependabot-')) return 'background'
  if (tabId.startsWith('team-')) return 'team'
  return 'main'
}

// Claude Code keeps auto-memory per start folder (~/.claude/projects/<folder with non-alphanumerics as "-">/memory). A
// thread in a repo or a worktree under the workspace root would see none of the root's memory, so it shares the root's
// folder. null: leave it to Claude Code (outside the workspace, the root itself, or no root configured)
export const projectKey = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, '-')
export function sharedMemoryDir(cwd: string, root: string, extraRoots: string[], claudeDir: string, win = process.platform === 'win32'): string | null {
  if (!root || !cwd) return null
  const P = win ? win32 : posix
  const norm = (p: string) => (win ? P.resolve(p).toLowerCase() : P.resolve(p))
  const inside = (dir: string, base: string) => {
    if (!base) return false
    const r = P.relative(norm(base), norm(dir))
    return !!r && !r.startsWith('..') && !P.isAbsolute(r)
  }
  if (norm(cwd) === norm(root)) return null
  if (!inside(cwd, root) && !extraRoots.some((x) => inside(cwd, x))) return null
  return join(claudeDir, 'projects', projectKey(root), 'memory')
}

// the words of a user message as it went to the engine, for putting it back in the message box
export function messageParts(content: unknown): { text: string; images: { mediaType: string; data: string }[] } {
  if (typeof content === 'string') return { text: content, images: [] }
  const blocks = Array.isArray(content) ? content : []
  return {
    text: blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n'),
    images: blocks.filter((b) => b?.type === 'image' && b.source?.type === 'base64').map((b) => ({ mediaType: String(b.source.media_type), data: String(b.source.data) })),
  }
}
