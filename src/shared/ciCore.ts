// A branch's pull request and its checks (from `gh pr view --json ...`), and the message that asks a thread to ship
// its branch. Orbit itself never commits, pushes or opens the PR: the thread does, by the project's own rules.

export type CheckState = 'none' | 'pending' | 'failing' | 'passing'
export type Checks = { state: CheckState; passed: number; failed: number; pending: number; total: number }
export type PrChecks = { number: number; url: string; state: string; isDraft: boolean; title: string; checks: Checks }
// null: the branch has no pull request; unavailable: gh is missing, signed out, or the remote is not GitHub
export type PrChecksResult = PrChecks | null | { unavailable: string }

const PASS = ['SUCCESS', 'SKIPPED', 'NEUTRAL']
const FAIL_STATUS = ['FAILURE', 'ERROR']

// one rollup entry: a CheckRun (status + conclusion) or a StatusContext (state)
function verdict(c: Record<string, unknown>): 'passed' | 'failed' | 'pending' {
  const up = (v: unknown) => String(v ?? '').toUpperCase()
  if (c.status === undefined && c.state !== undefined) {
    const s = up(c.state)
    return s === 'SUCCESS' ? 'passed' : FAIL_STATUS.includes(s) ? 'failed' : 'pending'
  }
  if (up(c.status) !== 'COMPLETED') return 'pending'
  // cancelled, timed out, action required, startup failure and the like are failures
  return PASS.includes(up(c.conclusion)) ? 'passed' : 'failed'
}

// a failure beats pending; skipped and neutral count as passed
export function summarizeChecks(rollup: unknown): Checks {
  const out: Checks = { state: 'none', passed: 0, failed: 0, pending: 0, total: 0 }
  for (const c of Array.isArray(rollup) ? rollup : []) {
    if (!c || typeof c !== 'object') continue
    out[verdict(c as Record<string, unknown>)]++
    out.total++
  }
  out.state = !out.total ? 'none' : out.failed ? 'failing' : out.pending ? 'pending' : 'passing'
  return out
}

// the names of the failing checks (a CheckRun's name, a StatusContext's context), each once
export function failingChecks(rollup: unknown): string[] {
  const names = (Array.isArray(rollup) ? rollup : [])
    .filter((c) => c && typeof c === 'object' && verdict(c as Record<string, unknown>) === 'failed')
    .map((c) => String((c as Record<string, unknown>).name ?? (c as Record<string, unknown>).context ?? '').trim())
    .filter(Boolean)
  return [...new Set(names)]
}

// "3 of 5 passed, 1 failed, 1 running"
export function checksText(c: Checks): string {
  if (!c.total) return 'no checks'
  return [`${c.passed} of ${c.total} passed`, c.failed ? `${c.failed} failed` : '', c.pending ? `${c.pending} running` : ''].filter(Boolean).join(', ')
}

// gh pr view's JSON
export function parsePrView(out: string): PrChecks {
  const j = JSON.parse(out)
  return { number: Number(j.number), url: String(j.url ?? ''), state: String(j.state ?? ''), isDraft: !!j.isDraft, title: String(j.title ?? ''), checks: summarizeChecks(j.statusCheckRollup) }
}

// gh's failure: the branch simply has no PR (null), or gh cannot tell (its first line, said plainly)
export function prViewError(message: string): PrChecksResult {
  const line = String(message).trim().split('\n')[0]
  if (/no (open )?pull requests? found/i.test(line)) return null
  if (/ENOENT/.test(line)) return { unavailable: 'gh (the GitHub CLI) is not installed' }
  return { unavailable: line || 'gh failed' }
}

export const protectedBranch = (name: string | null | undefined): boolean => /^(main|master|prod|production)$|^release\//.test(String(name ?? ''))

// the message sent to the thread: name the steps, the project's own instructions say how
export function shipPrompt({ branch, upstream, ahead, files, pr }: { branch: string; upstream: string | null; ahead: number; files: number; pr?: { number: number } | null }): string {
  const where = `${files} changed file${files === 1 ? '' : 's'}, ${upstream ? `${ahead} commit${ahead === 1 ? '' : 's'} ahead of ${upstream}` : 'no upstream yet'}`
  const steps = 'Follow this project\'s own shipping rules from your instructions: the ticket, tests, lint and type checks, reviews, and proof in the running app where a verification skill covers the change.'
  const finish = pr
    ? `Then commit and push the new commits to the existing pull request #${pr.number} (do not open another). Keep it ready for review (not a draft), on the repo's PR template, with no attribution lines; update its description to cover the new commits.`
    : 'Then commit, push, and open a pull request that is ready for review (not a draft), follows the repo\'s PR template, and has no attribution lines.'
  return `Ship branch \`${branch}\` (${where}). ${steps} ${finish} Say plainly in the PR anything you skipped and why.`
}
