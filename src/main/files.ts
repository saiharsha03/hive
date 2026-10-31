// One folder level for the Files panel: folders first, then files, case-insensitive (like VS Code).
import { execFile } from 'node:child_process'
import { existsSync, type Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDecorations, type Decorations, type RepoStatus } from '../shared/fileDecoCore'

export type Entry = { name: string; path: string; dir: boolean }

const HIDDEN = new Set(['.git']) // VS Code hides .git by default

export async function listDir(dir: string): Promise<Entry[]> {
  const items = await readdir(dir, { withFileTypes: true })
  return items
    .filter((d) => !HIDDEN.has(d.name))
    .map((d) => ({ name: d.name, path: join(dir, d.name), dir: d.isDirectory() }))
    .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
}

// Git decorations for the Files panel: one `git status` per repo under the browsed folder, cached briefly.
// The browsed folder can be inside a repo, be a repo, or be a workspace of many repos (each child, or grandchild, its own).
const CACHE_MS = 3000
const cache = new Map<string, { at: number; p: Promise<RepoStatus | null> }>()

function gitOut(cwd: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout: 30_000, maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
    (err, out) => (err ? rej(err) : res(out.toString()))))
}

// the status of one repo, shared by every call within CACHE_MS; fresh skips the cache (after an agent's edit)
function repoStatus(top: string, fresh: boolean): Promise<RepoStatus | null> {
  const hit = cache.get(top)
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit.p
  // --ignored=matching never walks into an ignored folder; the default (traditional) takes seconds on node_modules
  const p = gitOut(top, ['status', '--porcelain=v2', '-z', '--ignored=matching']).then((z) => ({ top, z }), () => null)
  cache.set(top, { at: Date.now(), p })
  return p
}

const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__'])

// repos under root that are their own repos (a .git folder, or a .git file for a worktree): children, then grandchildren
async function nestedRepos(root: string, depth: number): Promise<string[]> {
  let items: Dirent[]
  try { items = await readdir(root, { withFileTypes: true }) } catch { return [] }
  const found = await Promise.all(items.filter((d) => d.isDirectory() && !SKIP.has(d.name)).map(async (d) => {
    const dir = join(root, d.name)
    if (existsSync(join(dir, '.git'))) return [dir]
    return depth > 1 ? nestedRepos(dir, depth - 1) : []
  }))
  return found.flat()
}

export async function gitDecorations(root: string, fresh = false): Promise<Decorations> {
  const own = await gitOut(root, ['rev-parse', '--show-toplevel']).then((s) => s.trim(), () => '')
  const tops = new Set<string>(own ? [own] : [])
  for (const dir of await nestedRepos(root, 2)) tops.add(dir)
  const statuses = await Promise.all([...tops].map((t) => repoStatus(t, fresh)))
  return buildDecorations(root, statuses.filter((s): s is RepoStatus => !!s))
}
