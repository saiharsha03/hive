// Auto-fix and Auto-archive for open threads with a pull request: every minute (and whenever the Changes panel reads
// the PR) the thread's live PR goes through prAutoCore, which says whether to send the fix prompt or archive it.
import type { Session } from './chat'
import { autoArchiveNow, autoFixNow } from '../../shared/prAutoCore'
import type { MergeInfo } from '../../shared/prCore'
import { notice, send } from './actions'
import { getPref, setPref } from './prefs'
import { getSessions } from './store'
import { archiveKeepingWork, threadState } from './threads'

export const threadKey = (s: Pick<Session, 'id' | 'sessionId'>) => s.sessionId ?? s.id
export const threadFolder = (s: Session) => s.worktrees?.at(-1)?.path ?? s.cwd ?? ''

// what Auto-fix already sent, per thread: the head sha of the checks prompt and the newest review comment
type Sent = { sha?: string; at?: number }
const SENT = 'prAuto.sent'
const sentOf = (key: string): Sent => getPref<Record<string, Sent>>(SENT, {})[key] ?? {}
export const markSent = (key: string, s: Sent) => setPref(SENT, { ...getPref<Record<string, Sent>>(SENT, {}), [key]: { ...sentOf(key), ...s } })

// act on one read of a thread's PR
export function applyPr(sessionId: string, info: MergeInfo) {
  const s = getSessions().find((x) => x.id === sessionId)
  if (!s) return
  const key = threadKey(s)
  const st = threadState(key)
  const sent = sentOf(key)
  const fix = autoFixNow({ on: st?.autoFix, busy: s.busy, state: info.pr.state, checks: info.pr.checks.state, head: info.pr.headRefOid,
    failing: info.pr.failing ?? [], feedback: info.pr.feedback ?? [], sentSha: sent.sha, sentAt: sent.at }, info.pr.number)
  if (fix) {
    markSent(key, fix.kind === 'checks' ? { sha: fix.sha } : { at: fix.at })
    send(s.id, fix.text, [])
  }
  if (autoArchiveNow({ on: !!st?.autoArchive, busy: s.busy, archived: !!st?.archivedAt, state: info.pr.state })) {
    archiveKeepingWork(key)
    notice(`Archived ${s.title}: pull request #${info.pr.number} ${info.pr.state === 'MERGED' ? 'merged' : 'closed'}.`)
  }
}

const dirs = new Map<string, string>()
let polling = false
async function poll() {
  if (polling) return
  polling = true
  try { for (const s of getSessions()) await pollOne(s) } finally { polling = false }
}
async function pollOne(s: Session) {
  const st = threadState(threadKey(s))
  const where = threadFolder(s)
  if ((!st?.autoFix && !st?.autoArchive) || st.archivedAt || s.busy || !where) return
  try {
    let dir = dirs.get(where)
    if (!dir) {
      const at = await window.api.gitLocate(`${where.replace(/[\\/]+$/, '')}/.`)
      if (!at) return
      dir = at.dir
      dirs.set(where, dir)
    }
    const info = await window.api.gitPrMergeInfo(dir)
    if (info && !('unavailable' in info)) applyPr(s.id, info)
  } catch { /* gh could not tell this time; the next minute tries again */ }
}

let timer: ReturnType<typeof setInterval> | null = null
export function startPrAuto() {
  if (timer) return
  timer = setInterval(() => void poll(), 60_000)
}
