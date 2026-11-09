// Diffs as hunks of lines, shared by the Git panel and the chat's file-change view: pure functions, no I/O.

export type DiffLine = { t: ' ' | '+' | '-'; text: string; a: number | null; b: number | null } // a / b: old / new line number
export type Hunk = { a: number; b: number; lines: DiffLine[] } // a / b: the first old / new line the hunk covers
export type FileDiff = { path: string; oldPath?: string; binary: boolean; hunks: Hunk[] }

// lines of a hunk given as ' x' / '+x' / '-x' strings, numbered from the hunk's start
export function hunkFrom(a: number, b: number, raw: string[]): Hunk {
  const lines: DiffLine[] = []
  let o = a, n = b
  for (const r of raw) {
    const t = r[0]
    const text = r.slice(1).replace(/\r$/, '')
    if (t === '+') lines.push({ t, text, a: null, b: n++ })
    else if (t === '-') lines.push({ t, text, a: o++, b: null })
    else if (t === ' ' || r === '') lines.push({ t: ' ', text, a: o++, b: n++ })
    // '\ No newline at end of file' and anything else is not a line of the file
  }
  return { a, b, lines }
}

// Claude Code's structuredPatch (on Edit / MultiEdit / Write results): real line numbers in the file
export function fromPatch(patch: unknown): Hunk[] | null {
  if (!Array.isArray(patch) || !patch.length) return null
  const out: Hunk[] = []
  for (const p of patch) {
    if (!p || !Array.isArray(p.lines)) return null
    // a hunk that starts at "line 0" (an empty side) still counts from 1
    out.push(hunkFrom(Math.max(1, Number(p.oldStart) || 1), Math.max(1, Number(p.newStart) || 1), p.lines.map(String)))
  }
  return out
}

export function counts(hunks: Hunk[]): { add: number; del: number } {
  let add = 0, del = 0
  for (const h of hunks) for (const l of h.lines) { if (l.t === '+') add++; else if (l.t === '-') del++ }
  return { add, del }
}

// unchanged lines hidden before hunk i (between the previous hunk and this one, or above the first)
export function gapBefore(hunks: Hunk[], i: number): number {
  const h = hunks[i]
  if (i === 0) return Math.max(0, h.a - 1)
  const prev = hunks[i - 1]
  const prevEnd = prev.a + prev.lines.filter((l) => l.t !== '+').length
  return Math.max(0, h.a - prevEnd)
}

// side-by-side rows: context on both sides; a run of removed lines is paired with the added lines that follow it
export type SplitRow = { l: DiffLine | null; r: DiffLine | null }
export function splitRows(h: Hunk): SplitRow[] {
  const rows: SplitRow[] = []
  const ls = h.lines
  let i = 0
  while (i < ls.length) {
    if (ls[i].t === ' ') { rows.push({ l: ls[i], r: ls[i] }); i++; continue }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < ls.length && ls[i].t === '-') dels.push(ls[i++])
    while (i < ls.length && ls[i].t === '+') adds.push(ls[i++])
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ l: dels[k] ?? null, r: adds[k] ?? null })
  }
  return rows
}

const splitLines = (t: string) => {
  if (!t) return []
  const ls = t.replace(/\r\n/g, '\n').split('\n')
  if (ls.at(-1) === '') ls.pop()
  return ls
}

// line diff of two texts as hunks with `context` unchanged lines around each change (Infinity: one hunk, whole text).
// Common start / end lines are matched first; the middle is a longest-common-subsequence table, or a plain
// "all removed, then all added" when the middle is too big for a table.
export function buildHunks(oldText: string, newText: string, context = 3): Hunk[] {
  const A = splitLines(oldText), B = splitLines(newText)
  let pre = 0
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++
  let suf = 0
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++
  const a = A.slice(pre, A.length - suf), b = B.slice(pre, B.length - suf)
  const mid: ('=' | '-' | '+')[] = []
  if (a.length * b.length <= 4_000_000) {
    const w = b.length + 1
    const L = new Uint32Array((a.length + 1) * w)
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      L[i * w + j] = a[i] === b[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1])
    let i = 0, j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { mid.push('='); i++; j++ }
      // removed lines before added ones on a tie, as git prints them (and as the split view pairs them)
      else if (i < a.length && (j >= b.length || L[(i + 1) * w + j] >= L[i * w + j + 1])) { mid.push('-'); i++ }
      else { mid.push('+'); j++ }
    }
  } else {
    mid.push(...a.map(() => '-' as const), ...b.map(() => '+' as const))
  }
  // every line, numbered
  const all: DiffLine[] = []
  let o = 1, n = 1
  for (let k = 0; k < pre; k++) all.push({ t: ' ', text: A[k], a: o++, b: n++ })
  let ia = 0, ib = 0
  for (const op of mid) {
    if (op === '=') { all.push({ t: ' ', text: a[ia++], a: o++, b: n++ }); ib++ }
    else if (op === '-') all.push({ t: '-', text: a[ia++], a: o++, b: null })
    else all.push({ t: '+', text: b[ib++], a: null, b: n++ })
  }
  for (let k = A.length - suf; k < A.length; k++) all.push({ t: ' ', text: A[k], a: o++, b: n++ })
  // keep changes plus their context; stretches farther than `context` from any change are left out
  const keep = all.map(() => false)
  all.forEach((l, k) => {
    if (l.t === ' ') return
    for (let x = Math.max(0, k - context); x <= Math.min(all.length - 1, k + context); x++) keep[x] = true
  })
  const hunks: Hunk[] = []
  let cur: DiffLine[] | null = null
  all.forEach((l, k) => {
    if (!keep[k]) { cur = null; return }
    if (!cur) { cur = []; hunks.push({ a: 0, b: 0, lines: cur }) }
    cur.push(l)
  })
  // a hunk's start numbers: its first line's, or for a side with no lines in it, where that side would be
  for (const h of hunks) {
    const idx = all.indexOf(h.lines[0])
    const before = all.slice(0, idx)
    h.a = h.lines.find((l) => l.a !== null)?.a ?? before.filter((l) => l.a !== null).length + 1
    h.b = h.lines.find((l) => l.b !== null)?.b ?? before.filter((l) => l.b !== null).length + 1
  }
  return hunks
}

// what an agent's Edit / MultiEdit / Write changed: Claude Code's own patch when the result carried one (real
// line numbers), else rebuilt from the tool input (numbered from the snippet; a Write is all added)
export const FILE_TOOLS = ['Edit', 'MultiEdit', 'Write']
export function toolHunks(name: string, input: any, patch?: unknown): Hunk[] {
  const p = fromPatch(patch)
  if (p) return p
  if (name === 'Write') return buildHunks('', String(input?.content ?? ''))
  if (name === 'Edit') return buildHunks(String(input?.old_string ?? ''), String(input?.new_string ?? ''))
  if (name === 'MultiEdit') return (Array.isArray(input?.edits) ? input.edits : []).flatMap((e: any) => buildHunks(String(e?.old_string ?? ''), String(e?.new_string ?? '')))
  return []
}
