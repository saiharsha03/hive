// The worktree tool and a worktree per thread: pure logic (branch names from a ticket, what a request does, what closing
// a thread does, the saved thread -> worktree links). No I/O, so it can be tested without Electron or git.
import { samePath, validBranchName, type Worktree } from './devCore'

// ---------- branch names ----------

// "Fix the login page!" -> "fix-the-login-page", cut to `max` characters
export function slugify(text: string, max = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '')
}

// "PROJ-123", "proj-123 Fix login", "PROJ-123: Fix login" -> key PROJ-123 plus the slug of the rest
export function parseTicket(ticket: string): { key: string; slug: string } | null {
  const m = ticket.trim().match(/^([A-Za-z][A-Za-z0-9]*-\d+)(?![A-Za-z0-9])[\s:-]*(.*)$/s)
  return m ? { key: m[1].toUpperCase(), slug: slugify(m[2]) } : null
}

export const ticketBranch = (t: { key: string; slug: string }) => `feat/${t.key}${t.slug ? `-${t.slug}` : ''}`

// a local branch already made for this ticket ("feat/PROJ-123-anything", "PROJ-123"), feat/ ones first
export function findTicketBranch(key: string, branches: string[]): string | null {
  const re = new RegExp(`(^|/)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-|$)`, 'i')
  const hits = branches.filter((b) => re.test(b))
  return hits.find((b) => b.startsWith('feat/')) ?? hits[0] ?? null
}

// a thread started with Worktree on: <prefix><slug of its first message>, or a timestamp when the message has no
// letters or digits; -2, -3... when that branch is taken. null = the prefix makes no valid branch name.
export function startBranch(prefix: string, text: string, now: Date, taken: (b: string) => boolean): string | null {
  const p = now
  const two = (n: number) => String(n).padStart(2, '0')
  const slug = slugify(text, 30) || `${p.getFullYear()}${two(p.getMonth() + 1)}${two(p.getDate())}-${two(p.getHours())}${two(p.getMinutes())}${two(p.getSeconds())}`
  const base = `${prefix.trim()}${slug}`
  if (!validBranchName(base)) return null
  for (let n = 1; ; n++) {
    const b = n === 1 ? base : `${base}-${n}`
    if (!taken(b)) return b
  }
}

// ---------- the worktree tool ----------

export type WorktreePlan =
  | { ok: false; error: string }
  | { ok: true; branch: string; act: 'reuse'; path: string }
  | { ok: true; branch: string; act: 'add'; create: boolean } // create = a new branch from the base

export function planWorktree(i: { branch?: string; ticket?: string; mainDir: string; worktrees: Worktree[]; localBranches: string[] }): WorktreePlan {
  const branchIn = i.branch?.trim()
  const ticketIn = i.ticket?.trim()
  if (!branchIn === !ticketIn) return { ok: false, error: 'Give either a branch or a ticket (not both).' }
  let branch = branchIn ?? ''
  if (ticketIn) {
    const t = parseTicket(ticketIn)
    if (!t) return { ok: false, error: `"${ticketIn}" does not start with a ticket key such as PROJ-123` }
    branch = findTicketBranch(t.key, i.localBranches) ?? ticketBranch(t)
  }
  if (!validBranchName(branch)) return { ok: false, error: `Not a valid branch name: ${branch}` }
  const have = i.worktrees.find((w) => w.branch === branch)
  if (have && samePath(have.path, i.mainDir)) {
    return { ok: false, error: `${branch} is checked out in the main checkout; a thread worktree needs a branch the main checkout is not on` }
  }
  if (have) return { ok: true, branch, act: 'reuse', path: have.path }
  return { ok: true, branch, act: 'add', create: !i.localBranches.includes(branch) }
}

// a repo name from the agent: a folder under the repos root, never absolute and never climbing out of it
export const validRepoName = (repo: string) =>
  !!repo.trim() && !/^([A-Za-z]:|[\\/])/.test(repo) && !repo.split(/[\\/]/).some((p) => p === '..' || p === '.' || p === '')

// ---------- closing a thread ----------

export const WIP_MESSAGE = 'WIP: auto-saved when thread closed'

// `git status --porcelain` output: is there anything to save? Hive's own copies (untracked root .env files and the
// node_modules link) do not count, and they are never committed.
// A dotenv file name: ".env", ".env.local", ".env.development.local". Not ".envrc" or ".environment-notes.md": a file
// that only starts with ".env" is somebody's work, and counting it as a copy deleted it with the worktree.
export const isDotenvName = (name: string) => /^\.env(\.[A-Za-z0-9_-]+)*$/.test(name)
const COPY = /^\?\? "?(\.env(?:\.[A-Za-z0-9_-]+)*|node_modules\/?)"?$/
const lines = (porcelain: string) => porcelain.replace(/\r/g, '').split('\n').filter(Boolean)
export const hasWork = (porcelain: string): boolean => lines(porcelain).some((l) => !COPY.test(l))
// the untracked root .env files Hive copied in: unstaged again after `git add -A`, so a WIP commit never holds them
export const envCopies = (porcelain: string): string[] =>
  lines(porcelain).map((l) => l.match(COPY)?.[1] ?? '').filter((f) => f.startsWith('.env'))

export type Cleanup = { act: 'remove' | 'gone' | 'refuse'; commit: boolean; note: string }
export function decideCleanup(i: { exists: boolean; isMain: boolean; registered: boolean; dirty: boolean; running: string[] }): Cleanup {
  if (i.isMain) return { act: 'refuse', commit: false, note: 'is the main checkout; never deleted' }
  if (!i.exists) return { act: 'gone', commit: false, note: 'already gone' }
  if (!i.registered) return { act: 'refuse', commit: false, note: 'is not a git worktree of the repo any more; left alone' }
  if (i.running.length) return { act: 'refuse', commit: false, note: `stop the service first (${i.running.join(', ')} running from it); worktree kept` }
  return { act: 'remove', commit: i.dirty, note: '' }
}

// ---------- saved thread -> worktree links ----------

export type WorktreeLink = { repo: string; path: string; branch: string; at: number }
export type LinkMap = Record<string, WorktreeLink[]>

export function addLink(map: LinkMap, thread: string, link: WorktreeLink): LinkMap {
  const rest = (map[thread] ?? []).filter((l) => !samePath(l.path, link.path))
  return { ...map, [thread]: [...rest, link] }
}

// a handoff: the new thread takes over the old one's worktrees, so closing the old one no longer deletes them
export function moveLinks(map: LinkMap, from: string, to: string): LinkMap {
  const moving = map[from] ?? []
  if (!moving.length || from === to) return map
  const { [from]: _old, ...rest } = map
  return moving.reduce((m, l) => addLink(m, to, l), rest as LinkMap)
}

// drop the links whose worktree is gone; a thread with none left leaves the map
export function dropLinks(map: LinkMap, thread: string, paths: string[]): LinkMap {
  const left = (map[thread] ?? []).filter((l) => !paths.some((p) => samePath(p, l.path)))
  const { [thread]: _old, ...rest } = map
  return left.length ? { ...rest, [thread]: left } : rest
}
