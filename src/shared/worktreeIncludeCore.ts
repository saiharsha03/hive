// .worktreeinclude, as Claude Code reads it: a file at the repo root in .gitignore syntax naming the git-ignored files
// (such as .env) to copy from the main checkout into a new worktree. Only files that match a pattern AND are
// git-ignored are copied (the caller lists the ignored ones), so a tracked file is never duplicated.
// Pure: paths are repo-relative with forward slashes, no I/O.

export type IncludeRule = { neg: boolean; dirOnly: boolean; segs: string[]; re: RegExp; source: string }

// one path segment of a glob as a regex: * and ? stay inside the segment, [...] is a class, the rest is literal
function segRe(seg: string): string {
  let out = ''
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (c === '\\' && i + 1 < seg.length) { out += seg[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); continue }
    if (c === '*') { out += '[^/]*'; continue }
    if (c === '?') { out += '[^/]'; continue }
    if (c === '[') {
      const end = seg.indexOf(']', i + 2)
      if (end > 0) {
        const body = seg.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')
        out += `[${body}]`
        i = end
        continue
      }
    }
    out += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return out
}
const segMatch = (pat: string, name: string) => new RegExp(`^${segRe(pat)}$`).test(name)

export function parseInclude(text: string): IncludeRule[] {
  const rules: IncludeRule[] = []
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    let p = raw.replace(/(?<!\\)\s+$/, '')
    if (!p || p.startsWith('#')) continue
    const neg = p.startsWith('!')
    if (neg) p = p.slice(1)
    else if (p.startsWith('\\!') || p.startsWith('\\#')) p = p.slice(1)
    const dirOnly = p.endsWith('/')
    p = p.replace(/\/+$/, '')
    if (!p) continue
    // a slash at the start or in the middle anchors the pattern to the root; otherwise it matches at any depth
    const anchored = p.includes('/')
    p = p.replace(/^\/+/, '')
    const segs = (anchored ? p : `**/${p}`).split('/').filter(Boolean)
    let re = ''
    segs.forEach((s, i) => {
      const last = i === segs.length - 1
      if (s === '**') re += last ? '.*' : '(?:.*/)?'
      else re += segRe(s) + (last ? '' : '/')
    })
    rules.push({ neg, dirOnly, segs, re: new RegExp(`^${re}$`), source: raw.trim() })
  }
  return rules
}

// the path and each folder above it, nearest last: "a/b/c.txt" -> a (dir), a/b (dir), a/b/c.txt
function chain(path: string, isDir: boolean): { p: string; dir: boolean }[] {
  const parts = path.split('/').filter(Boolean)
  return parts.map((_, i) => ({ p: parts.slice(0, i + 1).join('/'), dir: i < parts.length - 1 || isDir }))
}
const hits = (r: IncludeRule, path: string, isDir: boolean) => chain(path, isDir).some((x) => (!r.dirOnly || x.dir) && r.re.test(x.p))

// is this path named by the file? The last pattern that matches it, or a folder it is in, decides ("!" = not copied)
export function included(rules: IncludeRule[], path: string, isDir = false): boolean {
  let on = false
  for (const r of rules) if (hits(r, path, isDir)) on = !r.neg
  return on
}

// a folder git ignores as a whole: worth walking into? Yes when the folder itself is included, when an anchored
// pattern names a path inside it, or (for a pattern starting with **/, or with no slash) when the first name after
// the **/ is one of the folder names on its path, as Claude Code does. So ".env" never walks into node_modules.
export function mayReach(rules: IncludeRule[], dir: string): boolean {
  if (included(rules, dir, true)) return true
  const d = dir.split('/').filter(Boolean)
  return rules.some((r) => {
    if (r.neg) return false
    if (r.segs[0] === '**') {
      const first = r.segs.find((s) => s !== '**')
      return !!first && d.some((name) => segMatch(first, name))
    }
    for (let i = 0; i < d.length; i++) {
      const s = r.segs[i]
      if (s === undefined) return false
      if (s === '**') return true
      if (!segMatch(s, d[i])) return false
    }
    return r.segs.length > d.length
  })
}
