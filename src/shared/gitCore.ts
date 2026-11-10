// Git panel: pure parsing of git's own output (status, numstat, log, unified diffs) and the argument rules.
// No I/O, so it can be tested without Electron.
import { hunkFrom, type FileDiff } from './diffCore'

export type GitTarget = { name: string; dir: string; repo: string; worktree: boolean }
export type GitRow = GitTarget & { branch: string | null; upstream: string | null; ahead: number; behind: number; changes: number; error?: string }
export type FileArea = 'staged' | 'unstaged' | 'untracked'

export type StatusFile = { path: string; orig?: string; x: string; y: string; kind: 'changed' | 'unmerged' | 'untracked' | 'ignored' }
export type Status = { head: string | null; branch: string | null; upstream: string | null; ahead: number; behind: number; files: StatusFile[] }

// `git status --porcelain=v2 -b -z`: header lines "# branch.*", then one record per path (NUL-separated)
export function parseStatus(z: string): Status {
  const s: Status = { head: null, branch: null, upstream: null, ahead: 0, behind: 0, files: [] }
  const recs = z.split('\0')
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]
    if (!r) continue
    if (r.startsWith('# ')) {
      const [key, ...rest] = r.slice(2).split(' ')
      const v = rest.join(' ')
      if (key === 'branch.oid') s.head = v === '(initial)' ? null : v
      else if (key === 'branch.head') s.branch = v === '(detached)' ? null : v
      else if (key === 'branch.upstream') s.upstream = v
      else if (key === 'branch.ab') {
        const m = v.match(/^\+(\d+) -(\d+)$/)
        if (m) { s.ahead = Number(m[1]); s.behind = Number(m[2]) }
      }
      continue
    }
    const fields = (n: number) => { const p = r.split(' '); return { f: p.slice(0, n), path: p.slice(n).join(' ') } }
    if (r[0] === '1') { const { f, path } = fields(8); s.files.push({ path, x: f[1][0], y: f[1][1], kind: 'changed' }) }
    else if (r[0] === '2') { const { f, path } = fields(9); s.files.push({ path, orig: recs[++i], x: f[1][0], y: f[1][1], kind: 'changed' }) }
    else if (r[0] === 'u') { const { f, path } = fields(10); s.files.push({ path, x: f[1][0], y: f[1][1], kind: 'unmerged' }) }
    else if (r[0] === '?') s.files.push({ path: r.slice(2), x: '?', y: '?', kind: 'untracked' })
    else if (r[0] === '!') s.files.push({ path: r.slice(2), x: '!', y: '!', kind: 'ignored' }) // only with --ignored (the Files panel)
  }
  return s
}

// `git diff --numstat -z`: "add\tdel\tpath\0", or for a rename "add\tdel\t\0old\0new\0"; binary files count "-"
export type NumStat = { add: number; del: number; binary: boolean }
export function parseNumstat(z: string): Map<string, NumStat> {
  const out = new Map<string, NumStat>()
  const recs = z.split('\0')
  for (let i = 0; i < recs.length; i++) {
    const m = recs[i].replace(/^\n/, '').match(/^(-|\d+)\t(-|\d+)\t(.*)$/s)
    if (!m) continue
    let path = m[3]
    if (path === '') { i++; path = recs[++i] ?? '' } // rename: old, then new
    const binary = m[1] === '-'
    out.set(path, { add: binary ? 0 : Number(m[1]), del: binary ? 0 : Number(m[2]), binary })
  }
  return out
}

export type Entry = { path: string; orig?: string; letter: string; add?: number; del?: number; binary?: boolean }
export type Detail = { branch: string | null; head: string | null; upstream: string | null; ahead: number; behind: number; staged: Entry[]; unstaged: Entry[]; untracked: Entry[] }

// the detail view's three groups; a file changed in both the index and the work tree shows in both
export function detailOf(statusZ: string, stagedNum: string, unstagedNum: string): Detail {
  const s = parseStatus(statusZ)
  const sn = parseNumstat(stagedNum)
  const un = parseNumstat(unstagedNum)
  const d: Detail = { branch: s.branch, head: s.head, upstream: s.upstream, ahead: s.ahead, behind: s.behind, staged: [], unstaged: [], untracked: [] }
  const withNum = (e: Entry, n?: NumStat): Entry => (n ? { ...e, add: n.add, del: n.del, binary: n.binary } : e)
  for (const f of s.files) {
    if (f.kind === 'ignored') continue
    const base = { path: f.path, ...(f.orig ? { orig: f.orig } : {}) }
    if (f.kind === 'untracked') d.untracked.push({ path: f.path, letter: '?' })
    else if (f.kind === 'unmerged') d.unstaged.push(withNum({ ...base, letter: 'U' }, un.get(f.path)))
    else {
      if (f.x !== '.') d.staged.push(withNum({ ...base, letter: f.x }, sn.get(f.path)))
      if (f.y !== '.') d.unstaged.push(withNum({ path: f.path, letter: f.y }, un.get(f.path)))
    }
  }
  return d
}

// `git log --format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e`
export const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e'
export type Commit = { sha: string; short: string; author: string; at: number; title: string } // at: unix seconds
export function parseLog(out: string): Commit[] {
  return out.split('\x1e').map((r) => r.replace(/^\s+/, '')).filter(Boolean).map((r) => {
    const [sha, short, author, at, ...title] = r.split('\x1f')
    return { sha, short, author, at: Number(at), title: title.join('\x1f').trim() }
  })
}

export function relativeTime(atSec: number, nowMs: number): string {
  const s = Math.max(0, Math.round(nowMs / 1000 - atSec))
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'} ago`
  if (s < 60) return 'just now'
  if (s < 3600) return n(Math.floor(s / 60), 'minute')
  if (s < 86400) return n(Math.floor(s / 3600), 'hour')
  if (s < 86400 * 30) return n(Math.floor(s / 86400), 'day')
  if (s < 86400 * 365) return n(Math.floor(s / (86400 * 30)), 'month')
  return n(Math.floor(s / (86400 * 365)), 'year')
}

// `git for-each-ref --format=%(refname:short) refs/heads`
export const parseBranches = (out: string) => out.replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean)

// plain push; the first push of a branch with no upstream sets it. Never --force.
export function pushArgs(s: Pick<Status, 'branch' | 'upstream'>): string[] {
  if (!s.branch) throw new Error('HEAD is detached: switch to a branch before pushing')
  return s.upstream ? ['push'] : ['push', '-u', 'origin', s.branch]
}

// a path from the page: relative, inside the repo, never read as an option or as pathspec magic (":/", ":(top)x",
// ":!x" would reach outside the one file; main also runs git with --literal-pathspecs)
export const safePath = (p: string) =>
  !!p && !p.startsWith('-') && !p.startsWith(':') && !/^([a-zA-Z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes('..') && !p.includes('\0')
export const safeSha = (s: string) => /^[0-9a-f]{7,40}$/i.test(s)

// unified diff text (`git diff`, `git show`, `git diff --no-index`) -> one entry per file
export function parseUnifiedDiff(text: string): FileDiff[] {
  const out: FileDiff[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let cur: FileDiff | null = null
  let header = ''
  let i = 0
  const strip = (p: string) => p.replace(/\t$/, '').replace(/^"(.*)"$/, '$1')
  const finish = () => {
    if (!cur) return
    if (!cur.path) {
      // no ---/+++ lines (binary, mode-only, pure rename): read the path off "diff --git a/P b/P"
      const rest = header.slice('diff --git '.length)
      const half = (rest.length - 1) / 2
      cur.path = Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3) ? rest.slice(2, half) : rest
    }
    out.push(cur)
  }
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('diff --git ')) {
      finish()
      cur = { path: '', binary: false, hunks: [] }
      header = l
      i++
      continue
    }
    if (!cur) { i++; continue }
    if (l.startsWith('rename from ')) cur.oldPath = l.slice(12)
    else if (l.startsWith('rename to ')) cur.path = l.slice(10)
    else if (l.startsWith('Binary files ')) cur.binary = true
    else if (l.startsWith('--- ')) { const p = strip(l.slice(4)); if (p !== '/dev/null') cur.oldPath = p.replace(/^a\//, '') }
    else if (l.startsWith('+++ ')) {
      const p = strip(l.slice(4))
      cur.path = p === '/dev/null' ? (cur.oldPath ?? '') : p.replace(/^b\//, '')
      if (cur.oldPath === cur.path) delete cur.oldPath
    } else {
      const m = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (m) {
        let oldLeft = m[2] === undefined ? 1 : Number(m[2])
        let newLeft = m[4] === undefined ? 1 : Number(m[4])
        const raw: string[] = []
        i++
        while (i < lines.length && (oldLeft > 0 || newLeft > 0)) {
          const r = lines[i]
          if (r.startsWith('\\')) { i++; continue }
          if (r.startsWith('+')) newLeft--
          else if (r.startsWith('-')) oldLeft--
          else { oldLeft--; newLeft-- }
          raw.push(r)
          i++
        }
        while (i < lines.length && lines[i].startsWith('\\')) i++
        cur.hunks.push(hunkFrom(Math.max(1, Number(m[1])), Math.max(1, Number(m[3])), raw))
        continue
      }
    }
    i++
  }
  finish()
  return out
}
