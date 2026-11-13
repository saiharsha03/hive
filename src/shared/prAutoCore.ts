// Auto-fix and auto-archive for a thread's pull request: when to ask the thread to fix failing checks or answer review
// comments, and when to archive it. Pure, so "never twice for the same head" is tested; the Changes panel polls.
import type { Feedback } from './prCore'

const SHA = /^[0-9a-f]{40}$/i

// the message that asks the thread to fix the failing checks of its PR
export function fixChecksPrompt(pr: number, failing: string[]): string {
  const names = failing.length ? failing.map((n) => `\`${n}\``).join(', ') : 'some checks'
  return `The CI checks on pull request #${pr} are failing: ${names}. Read their logs (\`gh pr checks ${pr}\`, then \`gh run view <run-id> --log-failed\` for each failing run), fix the cause, then commit and push to this same branch so PR #${pr} updates. Do not open another pull request.`
}

// the message that asks the thread to address new review comments
export function fixReviewPrompt(pr: number, authors: string[]): string {
  const who = [...new Set(authors)].join(', ') || 'a reviewer'
  return `New review comments on pull request #${pr} from ${who}. Read them (\`gh pr view ${pr} --comments\`, and the inline ones with \`gh api repos/{owner}/{repo}/pulls/${pr}/comments\`), address them, then commit and push to this same branch so PR #${pr} updates. Do not open another pull request.`
}

export type AutoFixIn = {
  on: number | undefined // when Auto-fix was turned on (ms), undefined when off
  busy: boolean
  state: string // OPEN, MERGED, CLOSED
  checks: string // ciCore's CheckState
  head: string
  failing: string[]
  feedback: Feedback[]
  sentSha: string | undefined // the head the checks prompt was last sent for
  sentAt: number | undefined // the newest review comment already sent
}
export type AutoFixOut = { kind: 'checks'; sha: string; text: string } | { kind: 'review'; at: number; text: string } | null

// What Auto-fix sends now, if anything: only while it is on, the thread idle and the PR open. Failing checks are sent
// once per head sha; review comments newer than both the switch-on and the last ones sent, once.
export function autoFixNow(x: AutoFixIn, pr: number): AutoFixOut {
  if (!x.on || x.busy || x.state !== 'OPEN') return null
  if (x.checks === 'failing' && SHA.test(x.head) && x.sentSha?.toLowerCase() !== x.head.toLowerCase()) return { kind: 'checks', sha: x.head, text: fixChecksPrompt(pr, x.failing) }
  const since = Math.max(x.on, x.sentAt ?? 0)
  const fresh = x.feedback.filter((f) => f.at > since)
  if (fresh.length) return { kind: 'review', at: Math.max(...fresh.map((f) => f.at)), text: fixReviewPrompt(pr, fresh.map((f) => f.author)) }
  return null
}

// archive now: Auto-archive is on, the PR merged or closed, the thread is idle and not archived already
export const autoArchiveNow = (x: { on: boolean; busy: boolean; archived: boolean; state: string }): boolean =>
  x.on && !x.busy && !x.archived && (x.state === 'MERGED' || x.state === 'CLOSED')
