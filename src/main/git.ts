// Git panel, main process: plain git, no Claude. The repos are the ones Pull latest lists, plus every extra worktree
// of them (thread worktrees, dev stack worktrees). The page names a folder from that list, never a command.
// Commits run the repo's hooks (never --no-verify); push is plain (never --force); nothing here discards work.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { parseWorktrees } from '../shared/devCore'
import { sameDir } from './paths'
import { detailOf, LOG_FORMAT, parseBranches, parseLog, parseStatus, pushArgs, safePath, safeSha, type Commit, type Detail, type FileArea, type GitRow, type GitTarget } from '../shared/gitCore'
import type { Loaded } from './devConfig'
import { scanRepos } from './pull'
import { appName } from '../shared/appName'
import { blocked, TEST_MODE } from './testMode'


const PARALLEL = 6
let loaded: Loaded | null = null
let known: GitTarget[] = []

export function initGit(l: Loaded) { loaded = l }

type Run = { code: number; out: string; err: string }
// git's own output either way; okCodes lists the exit codes that are not failures
function run(cwd: string, args: string[], timeout = 120_000, okCodes = [0]): Promise<Run> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout, maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : -1) : 0
        const r = { code, out: stdout.toString(), err: stderr.toString() }
        if (okCodes.includes(code)) resolve(r)
        else reject(new Error((r.err.trim() || r.out.trim() || err?.message || `git exited with ${code}`)))
      })
  })
}
const git = async (cwd: string, args: string[], timeout?: number) => (await run(cwd, args, timeout)).out
// what a write command printed, for the panel's output box
const said = (r: Run) => [r.out.trim(), r.err.trim()].filter(Boolean).join('\n')

async function targets(): Promise<GitTarget[]> {
  if (!loaded?.config) throw new Error(loaded?.message || 'No .env loaded')
  const repos = scanRepos(loaded.config)
  const out: GitTarget[] = []
  await Promise.all(repos.map(async (r) => {
    out.push({ name: r.name, dir: r.dir, repo: r.name, worktree: false })
    try {
      for (const w of parseWorktrees(await git(r.dir, ['worktree', 'list', '--porcelain'], 30_000))) {
        if (!w.path || sameDir(w.path, r.dir) || !existsSync(w.path)) continue
        out.push({ name: `${r.name} / ${basename(w.path)}`, dir: w.path, repo: r.name, worktree: true })
      }
    } catch { /* the repo row still shows, with its own error */ }
  }))
  out.sort((a, b) => a.name.localeCompare(b.name))
  known = out
  return out
}

// only folders Hive lists; a worktree made since the last list is picked up by listing again
async function resolve(dir: string): Promise<string> {
  const find = () => known.find((t) => sameDir(t.dir, dir))
  const hit = find() ?? (await targets(), find())
  if (!hit) throw new Error(`${dir} is not a repo or worktree ${appName()} lists`)
  return hit.dir
}

const pathsOf = (paths: unknown): string[] => {
  const list = (Array.isArray(paths) ? paths : [paths]).map(String)
  const bad = list.find((p) => !safePath(p))
  if (bad !== undefined) throw new Error(`Not a path inside the repo: ${bad}`)
  return list
}

const statusZ = (dir: string) => git(dir, ['status', '--porcelain=v2', '-b', '-z'])

export async function gitList(): Promise<GitRow[]> {
  const ts = await targets()
  const rows: GitRow[] = new Array(ts.length)
  let next = 0
  const worker = async () => {
    while (next < ts.length) {
      const k = next++
      const t = ts[k]
      try {
        const s = parseStatus(await statusZ(t.dir))
        rows[k] = { ...t, branch: s.branch, upstream: s.upstream, ahead: s.ahead, behind: s.behind, changes: s.files.length }
      } catch (e) {
        rows[k] = { ...t, branch: null, upstream: null, ahead: 0, behind: 0, changes: 0, error: (e as Error).message.split('\n')[0] }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, ts.length) }, worker))
  return rows
}

export async function gitDetail(dir: string): Promise<Detail> {
  const d = await resolve(dir)
  const [s, staged, unstaged] = await Promise.all([statusZ(d), git(d, ['diff', '--cached', '--numstat', '-z']), git(d, ['diff', '--numstat', '-z'])])
  return detailOf(s, staged, unstaged)
}

// one file's diff; full = the whole file as context instead of 3 lines
export async function gitDiff(dir: string, path: string, area: FileArea, full: boolean, orig?: string): Promise<string> {
  const d = await resolve(dir)
  const [p] = pathsOf(path)
  const ctx = `-U${full ? 999999 : 3}`
  if (area === 'untracked') return (await run(d, ['diff', '--no-index', ctx, '--', '/dev/null', p], 120_000, [0, 1])).out
  const ps = orig ? [...pathsOf(orig), p] : [p]
  return git(d, area === 'staged' ? ['diff', '--cached', '-M', ctx, '--', ...ps] : ['diff', ctx, '--', ...ps])
}

export async function gitStage(dir: string, paths: string[]): Promise<void> {
  await git(await resolve(dir), ['add', '--', ...pathsOf(paths)])
}
export async function gitStageAll(dir: string): Promise<void> {
  await git(await resolve(dir), ['add', '-A'])
}
export async function gitUnstage(dir: string, paths: string[]): Promise<void> {
  const d = await resolve(dir)
  const ps = pathsOf(paths)
  const hasHead = await run(d, ['rev-parse', '-q', '--verify', 'HEAD'], 30_000, [0, 1]).then((r) => r.code === 0)
  // before the first commit there is no HEAD to restore from: take the files out of the index, keeping them on disk
  await git(d, hasHead ? ['restore', '--staged', '--', ...ps] : ['rm', '--cached', '-r', '-q', '--', ...ps])
}

// the repo's hooks run as for any commit; their output (and git's) comes back either way
export async function gitCommit(dir: string, message: string): Promise<string> {
  const d = await resolve(dir)
  if (!String(message).trim()) throw new Error('Write a commit message first')
  if (TEST_MODE) return blocked('git commit')
  return said(await run(d, ['commit', '-m', String(message)], 600_000))
}

export async function gitBranches(dir: string): Promise<{ current: string | null; branches: string[] }> {
  const d = await resolve(dir)
  const [cur, list] = await Promise.all([git(d, ['branch', '--show-current']), git(d, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])])
  return { current: cur.trim() || null, branches: parseBranches(list) }
}

// plain `git switch`: with changes in the way, git refuses and says why
export async function gitSwitch(dir: string, branch: string): Promise<string> {
  const d = await resolve(dir)
  const { branches } = await gitBranches(d)
  if (!branches.includes(branch) || branch.startsWith('-')) throw new Error(`No local branch ${branch}`)
  return said(await run(d, ['switch', branch]))
}

// a new branch from the current HEAD, switched to
export async function gitCreateBranch(dir: string, name: string): Promise<string> {
  const d = await resolve(dir)
  const b = String(name).trim()
  if (!b || b.startsWith('-')) throw new Error('Not a valid branch name')
  await git(d, ['check-ref-format', '--branch', b])
  return said(await run(d, ['switch', '-c', b]))
}

export async function gitLog(dir: string): Promise<Commit[]> {
  const d = await resolve(dir)
  const r = await run(d, ['log', '-n', '20', `--format=${LOG_FORMAT}`], 60_000, [0, 128]) // 128: no commits yet
  return r.code === 0 ? parseLog(r.out) : []
}

export async function gitShow(dir: string, sha: string): Promise<string> {
  const d = await resolve(dir)
  if (!safeSha(sha)) throw new Error('Not a commit id')
  return git(d, ['show', '--format=', '--patch', '-M', '--diff-merges=first-parent', sha])
}

// only on the user's click; -u origin <branch> when the branch has no upstream yet
export async function gitPush(dir: string): Promise<string> {
  const d = await resolve(dir)
  if (TEST_MODE) return blocked('git push')
  const args = pushArgs(parseStatus(await statusZ(d)))
  return `$ git ${args.join(' ')}\n${said(await run(d, args, 300_000))}`.trim()
}

export async function gitFetch(dir: string): Promise<string> {
  const d = await resolve(dir)
  return said(await run(d, ['fetch', '--prune'], 120_000)) || 'Fetched.'
}

// the listed repo or worktree a file is in (the deepest one, so a worktree inside a repo folder wins), and the
// file's path inside it; null when Hive lists none
export async function gitLocate(file: string): Promise<{ dir: string; name: string; path: string } | null> {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const f = norm(String(file))
  const find = () => known
    .filter((t) => f.toLowerCase().startsWith(`${norm(t.dir).toLowerCase()}/`))
    .sort((a, b) => b.dir.length - a.dir.length)[0]
  const hit = find() ?? (await targets(), find())
  return hit ? { dir: hit.dir, name: hit.name, path: f.slice(norm(hit.dir).length + 1) } : null
}
