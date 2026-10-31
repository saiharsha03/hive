// Pull latest, main process: plain git, no Claude. For every repo under the configured root (plus one level inside the
// configured agents folders): fetch, skip anything with uncommitted changes, never leave a branch that has unpushed
// commits, otherwise check out the default branch and `git pull --ff-only`.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { detectDefault, isAgentsFolder, planPull, scanName, skipped, type DevConfig, type RepoFacts } from '../shared/devCore'
import { blocked, TEST_MODE } from './testMode'

export type PullRow = { repo: string; result: string }
const PARALLEL = 4

const git = (cwd: string, args: string[], timeout = 120_000) =>
  new Promise<string>((ok, bad) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => (err ? bad(new Error((stderr || err.message).toString().trim().split('\n')[0])) : ok(stdout.toString())))
  })

const isRepo = (d: string) => existsSync(join(d, '.git'))
const dirs = (d: string) => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && scanName(e.name)).map((e) => e.name)

// repo name (relative to the root) -> folder
export function scanRepos(cfg: DevConfig): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = []
  for (const n of dirs(cfg.root)) {
    if (skipped(n, cfg.pullSkip)) continue
    const d = join(cfg.root, n)
    if (isRepo(d)) out.push({ name: n, dir: d })
    if (isAgentsFolder(n, cfg.agentsFolders)) {
      for (const c of dirs(d)) if (!skipped(`${n}/${c}`, cfg.pullSkip) && isRepo(join(d, c))) out.push({ name: `${n}/${c}`, dir: join(d, c) })
    }
  }
  return out
}

async function facts(dir: string, fetch: boolean): Promise<RepoFacts> {
  const f: RepoFacts = { dirty: false, current: null, defaultBranch: null, unpushed: 0, behind: 0 }
  if (fetch) {
    try { await git(dir, ['fetch', '--prune'], 60_000) } catch (e) { f.fetchError = `fetch failed: ${(e as Error).message}`; return f }
  }
  try {
    const sym = await git(dir, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']).catch(() => null)
    const remote = (await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])).split('\n').map((s) => s.trim().replace(/^origin\//, ''))
    f.defaultBranch = detectDefault(sym, remote)
    f.current = (await git(dir, ['branch', '--show-current'])).trim() || null
    f.dirty = (await git(dir, ['status', '--porcelain', '--untracked-files=no'])).trim().length > 0
    f.unpushed = Number((await git(dir, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])).trim())
    if (f.defaultBranch) {
      const local = await git(dir, ['rev-parse', '--verify', '-q', `refs/heads/${f.defaultBranch}`]).then(() => true).catch(() => false)
      f.behind = Number((await git(dir, ['rev-list', '--count', `${local ? f.defaultBranch : 'HEAD'}..origin/${f.defaultBranch}`])).trim())
    }
  } catch (e) {
    f.fetchError = (e as Error).message
  }
  return f
}

async function one(name: string, dir: string, dry: boolean): Promise<PullRow> {
  try {
    const f = await facts(dir, true)
    const plan = planPull(f)
    if (dry || plan.action !== 'pull') return { repo: name, result: dry ? plan.dry : plan.message }
    if (f.current !== f.defaultBranch) await git(dir, ['checkout', f.defaultBranch!])
    await git(dir, ['pull', '--ff-only'])
    return { repo: name, result: plan.message }
  } catch (e) {
    return { repo: name, result: `failed: ${(e as Error).message}` }
  }
}

// dry = look only: say what the button would do, change nothing (it does fetch)
export async function pullAll(cfg: DevConfig, dry: boolean, onRow: (r: PullRow) => void = () => {}): Promise<PullRow[]> {
  if (TEST_MODE && !dry) { const r = { repo: 'all repos', result: blocked('git pull') }; onRow(r); return [r] }
  const repos = scanRepos(cfg)
  const rows: PullRow[] = []
  let next = 0
  const worker = async () => {
    while (next < repos.length) {
      const r = repos[next++]
      const row = await one(r.name, r.dir, dry)
      rows.push(row)
      onRow(row)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, repos.length) }, worker))
  return rows.sort((a, b) => a.repo.localeCompare(b.repo))
}
