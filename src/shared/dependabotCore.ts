// Dependabot watcher: pure logic (config, the once-a-day schedule, `gh pr list` parsing, which PRs need a review,
// the reviewer's fixed prompt). No I/O, so it can be tested without Electron.

export type DependabotConfig = { repos: string[]; time: string; author: string } // repos as owner/name

const items = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function parseDependabotConfig(env: Record<string, string>): { config: DependabotConfig | null; problems: string[] } {
  const repos = items(env.HIVE_DEPENDABOT_REPOS)
  if (!repos.length) return { config: null, problems: [] }
  const problems = repos.filter((r) => !/^[\w.-]+\/[\w.-]+$/.test(r)).map((r) => `HIVE_DEPENDABOT_REPOS: ${r} is not owner/name`)
  const time = (env.HIVE_DEPENDABOT_TIME ?? '').trim() || '12:00'
  if (!parseTime(time)) problems.push(`HIVE_DEPENDABOT_TIME: ${time} is not HH:MM`)
  return {
    config: { repos: repos.filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r)), time: parseTime(time) ? time : '12:00', author: (env.HIVE_DEPENDABOT_AUTHOR ?? '').trim() || 'app/dependabot' },
    problems,
  }
}

export function parseTime(t: string): { h: number; m: number } | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h < 24 && min < 60 ? { h, m: min } : null
}

// the latest scheduled run at or before now, in local time: today's slot once it has passed, else yesterday's
export function lastSlot(now: Date, time: string): Date {
  const t = parseTime(time) ?? { h: 12, m: 0 }
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.m, 0, 0)
  if (s.getTime() > now.getTime()) s.setDate(s.getDate() - 1)
  return s
}

// due when the last run happened before the latest slot: also true at the first start after a missed slot
export const isDue = (now: Date, lastRun: number | null, time: string) => lastRun === null || lastRun < lastSlot(now, time).getTime()

export type OpenPr = { repo: string; number: number; title: string; url: string; branch: string; head: string; updatedAt: string }

// `gh pr list --json number,title,url,headRefName,headRefOid,updatedAt`
export function parsePrList(repo: string, json: string): OpenPr[] {
  const rows = JSON.parse(json || '[]')
  if (!Array.isArray(rows)) throw new Error('gh pr list did not return a list')
  return rows.map((r: any) => ({ repo, number: Number(r.number), title: String(r.title ?? ''), url: String(r.url ?? ''), branch: String(r.headRefName ?? ''), head: String(r.headRefOid ?? ''), updatedAt: String(r.updatedAt ?? '') }))
}

export type Reviewed = Record<string, { head: string; at: number; title: string }>
export const prKey = (p: Pick<OpenPr, 'repo' | 'number'>) => `${p.repo}#${p.number}`
// new, or Dependabot pushed a new head (a rebase or a new version) since the last review
export const needsReview = (p: OpenPr, reviewed: Reviewed) => reviewed[prKey(p)]?.head !== p.head

export const reviewTitle = (p: OpenPr) => `Dependabot: ${p.repo.split('/').pop()} #${p.number}`

export const reviewPrompt = (p: OpenPr, localDir: string | null) => [
  `Review this Dependabot pull request and decide whether it is safe to merge: ${p.url}`,
  `"${p.title}" in ${p.repo}, branch ${p.branch}, head ${p.head}.`,
  localDir ? `The repo is checked out at ${localDir}; read it to see how the dependency is actually used.` : 'There is no local checkout of this repo; read it through gh.',
  '',
  'The goal is a verdict you would stand behind: what changed between the versions, whether any of it affects how this repo actually uses the package, and whether tests back that up. Investigate however you judge best (you can run the tests yourself in a worktree).',
  'Do not merge, approve, comment on, close or push to the PR: the user decides.',
  'Start your final reply with one verdict line: "Verdict: safe", "Verdict: safe after <what needs doing first>" or "Verdict: not safe", then the evidence.',
].join('\n')
