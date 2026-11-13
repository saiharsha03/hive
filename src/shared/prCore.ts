// A thread's changes and its pull request, for the phone: the file list, one file's diff cut to a size the relay
// carries, and the merge rules. Pure, so every refusal is tested; main runs git and gh (git.ts).
import { checksText, failingChecks, protectedBranch, summarizeChecks, type Checks } from './ciCore'
import { parseNumstat } from './gitCore'

export type MergeMethod = 'squash' | 'merge' | 'rebase'
// failing: the failing checks' names; autoMerge: GitHub's auto-merge is on; feedback: review comments Auto-fix may
// act on (see reviewFeedback)
export type MergePr = {
  number: number; url: string; title: string; state: string; isDraft: boolean; headRefOid: string; baseRefName: string
  mergeable: string; mergeStateStatus: string; checks: Checks; checksText: string
  failing?: string[]; autoMerge?: boolean; feedback?: Feedback[]
}
export type Feedback = { author: string; at: number }
// block: why merging is not allowed now (null = it is), as the phone would be told with the PR's own head sha;
// autoBlock: the same for "Merge when ready"
export type MergeInfo = { pr: MergePr; repo: string; defaultBranch: string; method: MergeMethod | null; block: string | null; autoBlock?: string | null }
// null: the branch has no pull request; unavailable: gh cannot tell
export type MergeInfoResult = MergeInfo | null | { unavailable: string }
export type MergeResult = { ok: true; number: number; method: MergeMethod } | { ok: false; reason: string }

// a diff cut to maxLines lines and maxBytes bytes (whole lines), with a last line saying how many more there were
export function capDiff(text: string, maxLines = 1500, maxBytes = 200_000): { text: string; totalLines: number; shown: number; truncated: boolean } {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const enc = new TextEncoder()
  let shown = 0
  let bytes = 0
  for (const l of lines) {
    const b = enc.encode(l).length + 1
    if (shown >= maxLines || bytes + b > maxBytes) break
    bytes += b
    shown++
  }
  const truncated = shown < lines.length
  const kept = lines.slice(0, shown)
  if (truncated) kept.push(`… truncated, ${lines.length - shown} more lines`)
  return { text: kept.join('\n'), totalLines: lines.length, shown, truncated }
}

// the one method the repo allows; when several, squash, then merge, then rebase
export function pickMergeMethod(r: { mergeCommitAllowed?: boolean; squashMergeAllowed?: boolean; rebaseMergeAllowed?: boolean }): MergeMethod | null {
  if (r.squashMergeAllowed) return 'squash'
  if (r.mergeCommitAllowed) return 'merge'
  if (r.rebaseMergeAllowed) return 'rebase'
  return null
}

// release and production branches are never merged into from the phone, even when one is the default
const releaseBranch = (b: string) => protectedBranch(b) && !/^(main|master)$/.test(b)

// Why this PR may not be merged from the phone now, or null when it may. Every condition is GitHub's own word on the
// PR, read live; the head sha is the one the phone showed, so a push since then refuses the merge. A PR with no checks
// at all is refused too: right after a push GitHub can report none before CI has started.
function baseBlock(pr: MergePr | null, headSha: string, defaultBranch: string): string | null {
  if (!pr) return 'This branch has no pull request.'
  if (pr.state !== 'OPEN') return `Pull request #${pr.number} is ${pr.state.toLowerCase() || 'not open'}.`
  if (pr.isDraft) return `Pull request #${pr.number} is a draft.`
  if (!defaultBranch || pr.baseRefName !== defaultBranch) return `It targets ${pr.baseRefName || 'an unknown branch'}, not the default branch ${defaultBranch || '(unknown)'}.`
  if (releaseBranch(pr.baseRefName)) return `It targets ${pr.baseRefName}, a release branch: merge it on the computer.`
  if (!/^[0-9a-f]{40}$/i.test(String(headSha)) || pr.headRefOid.toLowerCase() !== String(headSha).toLowerCase()) return 'The branch has new commits since you looked. Look again before merging.'
  return null
}

// "Merge when ready" (GitHub's auto-merge): mergeBlock's rules except the checks and GitHub's merge state, which
// auto-merge waits for
export function autoMergeBlock(pr: (MergePr & { method?: MergeMethod | null }) | null, headSha: string, defaultBranch: string): string | null {
  const b = baseBlock(pr, headSha, defaultBranch)
  if (b || !pr) return b
  if (pr.mergeable === 'CONFLICTING') return 'It has conflicts with the base branch.'
  if (pr.method === null || pr.method === undefined) return 'The repo allows no merge method.'
  return null
}

export function mergeBlock(pr: (MergePr & { method?: MergeMethod | null }) | null, headShaFromPhone: string, defaultBranch: string): string | null {
  const b = baseBlock(pr, headShaFromPhone, defaultBranch)
  if (b || !pr) return b
  if (pr.checks.state === 'none') return 'No checks have reported on it.'
  if (pr.checks.state === 'failing') return `Its checks are failing (${checksText(pr.checks)}).`
  if (pr.checks.state !== 'passing') return `Its checks are still running (${checksText(pr.checks)}).`
  if (pr.mergeable === 'CONFLICTING') return 'It has conflicts with the base branch.'
  const s = pr.mergeStateStatus
  if (s !== 'CLEAN') {
    const why: Record<string, string> = {
      BEHIND: 'It is behind the base branch: update it first.',
      BLOCKED: 'GitHub says it is blocked (a required review or check is missing).',
      DIRTY: 'It has conflicts with the base branch.',
      UNSTABLE: 'GitHub says a check is not passing.',
      UNKNOWN: 'GitHub is still working out whether it can be merged. Try again in a moment.',
    }
    return why[s] ?? `GitHub says it cannot be merged cleanly (${s || 'no state'}).`
  }
  if (pr.method === null || pr.method === undefined) return 'The repo allows no merge method.'
  return null
}

// `gh pr view --json number,url,title,state,isDraft,headRefOid,baseRefName,mergeable,mergeStateStatus,statusCheckRollup`
// and `gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,defaultBranchRef,nameWithOwner`
export function parseMergeInfo(prJson: string, repoJson: string): MergeInfo {
  const j = JSON.parse(prJson)
  const r = JSON.parse(repoJson)
  const checks = summarizeChecks(j.statusCheckRollup)
  const pr: MergePr = {
    number: Number(j.number), url: String(j.url ?? ''), title: String(j.title ?? ''), state: String(j.state ?? ''), isDraft: !!j.isDraft,
    headRefOid: String(j.headRefOid ?? ''), baseRefName: String(j.baseRefName ?? ''), mergeable: String(j.mergeable ?? ''),
    mergeStateStatus: String(j.mergeStateStatus ?? ''), checks, checksText: checksText(checks),
    failing: failingChecks(j.statusCheckRollup), autoMerge: !!j.autoMergeRequest, feedback: reviewFeedback(j),
  }
  const defaultBranch = String(r.defaultBranchRef?.name ?? '')
  const method = pickMergeMethod(r)
  return {
    pr, repo: String(r.nameWithOwner ?? ''), defaultBranch, method,
    block: mergeBlock({ ...pr, method }, pr.headRefOid, defaultBranch), autoBlock: autoMergeBlock({ ...pr, method }, pr.headRefOid, defaultBranch),
  }
}

// Review comments Auto-fix acts on (gh pr view's comments and reviews): by someone other than the PR's author, who is
// the repository's owner, an organization member, a collaborator, or a GitHub App. An approval with no text is not one.
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR']
export function reviewFeedback(j: { author?: { login?: string }; comments?: unknown; reviews?: unknown }): Feedback[] {
  const me = String(j.author?.login ?? '').toLowerCase()
  const rows = [...(Array.isArray(j.comments) ? j.comments : []), ...(Array.isArray(j.reviews) ? j.reviews : [])] as Record<string, any>[]
  const out: Feedback[] = []
  for (const c of rows) {
    if (!c || typeof c !== 'object') continue
    const login = String(c.author?.login ?? '')
    const app = c.author?.is_bot === true || /\[bot\]$|^app\//.test(login)
    if (!login || login.toLowerCase() === me || !(app || TRUSTED.includes(String(c.authorAssociation ?? '')))) continue
    if (c.state === 'PENDING' || (c.state === 'APPROVED' && !String(c.body ?? '').trim()) || (c.state === 'DISMISSED')) continue
    const at = Date.parse(String(c.submittedAt ?? c.createdAt ?? ''))
    if (Number.isFinite(at)) out.push({ author: login, at })
  }
  return out.sort((a, b) => a.at - b.at)
}

// "Merge when ready" on (gh pr merge --auto, the method the repo allows, refused when the head moved) or off
// (--disable-auto); the PR number comes from the live info, never the page
export async function runAutoMerge(info: MergeInfoResult, headSha: string, on: boolean, write: (args: string[]) => Promise<unknown>): Promise<MergeResult> {
  if (info && 'unavailable' in info) return { ok: false, reason: info.unavailable }
  if (!info) return { ok: false, reason: 'This branch has no pull request.' }
  const n = String(info.pr.number)
  if (on) {
    const block = autoMergeBlock({ ...info.pr, method: info.method }, headSha, info.defaultBranch)
    if (block || !info.method) return { ok: false, reason: block ?? 'The repo allows no merge method.' }
  } else if (info.pr.state !== 'OPEN') return { ok: false, reason: `Pull request #${n} is ${info.pr.state.toLowerCase() || 'not open'}.` }
  try {
    await write(on ? ['pr', 'merge', n, '--auto', `--${info.method}`, '--match-head-commit', headSha] : ['pr', 'merge', n, '--disable-auto'])
  } catch (e) {
    return { ok: false, reason: String((e as Error).message ?? e) }
  }
  return { ok: true, number: info.pr.number, method: info.method ?? 'squash' }
}

// The only GitHub writes Hive makes, exactly: a merge of PR n by one method at a given head, the same with --auto, and
// turning auto-merge off. No --delete-branch, --admin or anything else.
export function allowedGhWrite(a: string[]): boolean {
  const method = /^--(squash|merge|rebase)$/
  const sha = /^[0-9a-f]{40}$/i
  if (a[0] !== 'pr' || a[1] !== 'merge' || !/^[1-9][0-9]*$/.test(a[2] ?? '')) return false
  const r = a.slice(3)
  if (r.length === 3) return method.test(r[0]) && r[1] === '--match-head-commit' && sha.test(r[2])
  if (r.length === 4) return r[0] === '--auto' && method.test(r[1]) && r[2] === '--match-head-commit' && sha.test(r[3])
  return r.length === 1 && r[0] === '--disable-auto'
}

// The merge itself, given the live info and the one gh write: refused unless mergeBlock allows it; the PR number and
// method come from the info, never the phone. No --delete-branch, --admin or --auto.
export async function runMerge(info: MergeInfoResult, headSha: string, write: (args: string[]) => Promise<unknown>): Promise<MergeResult> {
  if (info && 'unavailable' in info) return { ok: false, reason: info.unavailable }
  const block = mergeBlock(info ? { ...info.pr, method: info.method } : null, headSha, info?.defaultBranch ?? '')
  if (block || !info || !info.method) return { ok: false, reason: block ?? 'The repo allows no merge method.' }
  try {
    await write(['pr', 'merge', String(info.pr.number), `--${info.method}`, '--match-head-commit', headSha])
  } catch (e) {
    return { ok: false, reason: String((e as Error).message ?? e) }
  }
  return { ok: true, number: info.pr.number, method: info.method }
}

// `git diff --numstat -z`: one row per file; a binary file counts 0 and 0 and says so
export type FileStat = { path: string; add: number; del: number; binary: boolean }
export const numstatFiles = (z: string): FileStat[] => [...parseNumstat(z)].map(([path, n]) => ({ path, add: n.add, del: n.del, binary: n.binary }))

// a base branch name from gh, safe to put in `origin/<base>...HEAD`
export const safeBranch = (b: string): boolean => /^[A-Za-z0-9._/-]+$/.test(b) && !b.startsWith('-') && !b.includes('..') && !b.startsWith('/') && !b.endsWith('/')
