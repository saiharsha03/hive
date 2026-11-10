// Files panel git decorations, VS Code style: pure, so it can be tested without Electron.
// One `git status --porcelain=v2 -z --ignored=matching` per repo -> a map of path -> decoration, with folders rolled up.
import { parseStatus, type StatusFile } from './gitCore'

export type DecoKind = 'conflict' | 'deleted' | 'modified' | 'renamed' | 'added' | 'untracked' | 'ignored'
export type Deco = { kind: DecoKind; letter: string }
// what the page gets: exact paths, and folders whose whole content inherits (an untracked or ignored folder)
export type Decorations = { files: Record<string, Deco>; dirs: Record<string, Deco>; inherit: Record<string, Deco> }
export type RepoStatus = { top: string; z: string }

// strongest first: a folder takes the colour of the strongest change inside it. Ignored never rolls up.
const STRENGTH: Record<DecoKind, number> = { conflict: 6, deleted: 5, modified: 4, renamed: 3, added: 2, untracked: 1, ignored: 0 }
export const stronger = (a: DecoKind | undefined, b: DecoKind) => (a && STRENGTH[a] >= STRENGTH[b] ? a : b)

// one key per path: forward slashes, no trailing slash, case-folded (Windows paths are case-insensitive)
export const key = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export function decoOf(f: StatusFile): Deco {
  if (f.kind === 'unmerged') return { kind: 'conflict', letter: '!' }
  if (f.kind === 'untracked') return { kind: 'untracked', letter: 'U' }
  if (f.kind === 'ignored') return { kind: 'ignored', letter: '' }
  const xy = f.x + f.y
  if (xy.includes('D')) return { kind: 'deleted', letter: 'D' }
  if (xy.includes('M') || xy.includes('T')) return { kind: 'modified', letter: 'M' }
  if (xy.includes('R') || xy.includes('C')) return { kind: 'renamed', letter: 'R' }
  if (xy.includes('A')) return { kind: 'added', letter: 'A' }
  return { kind: 'modified', letter: 'M' }
}

// root: the folder being browsed. Folders between a change and the root (including the repo's own folder) get the dot.
export function buildDecorations(root: string, repos: RepoStatus[]): Decorations {
  const out: Decorations = { files: {}, dirs: {}, inherit: {} }
  const r = key(root)
  const within = (p: string) => p === r || p.startsWith(r + '/')
  for (const repo of repos) {
    const top = key(repo.top)
    for (const f of parseStatus(repo.z).files) {
      const isDir = f.path.endsWith('/') // git names a wholly untracked / ignored folder once, with a trailing slash
      const p = key(`${top}/${f.path}`)
      const d = decoOf(f)
      if (isDir) out.inherit[p] = d
      else out.files[p] = d
      if (d.kind === 'ignored') continue
      // the folder itself, when untracked, is coloured like its content; every parent gets the roll-up
      let dir = isDir ? p : p.slice(0, p.lastIndexOf('/'))
      while (dir && within(dir)) {
        const prev = out.dirs[dir]?.kind
        const kind = stronger(prev, d.kind)
        if (kind === prev) break // this folder, and so every folder above it, already shows at least this
        out.dirs[dir] = { kind, letter: '' }
        const up = dir.lastIndexOf('/')
        if (up < 0) break
        dir = dir.slice(0, up)
      }
    }
  }
  return out
}

// the decoration a row shows: its own, or the one it inherits from an untracked / ignored folder above it
export function lookup(d: Decorations, path: string, isDir: boolean): Deco | undefined {
  const p = key(path)
  const own = isDir ? d.dirs[p] ?? d.inherit[p] : d.files[p]
  if (own) return own
  for (let i = p.lastIndexOf('/'); i > 0; i = p.lastIndexOf('/', i - 1)) {
    const up = d.inherit[p.slice(0, i)]
    if (up) return up.kind === 'ignored' ? up : isDir ? { kind: up.kind, letter: '' } : up
  }
  return undefined
}
