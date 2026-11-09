// The "@" file mention of the message box: finding the @query at the cursor, ranking paths, quoting.
// Pure, so it can be tested without Electron.

export type Mention = { start: number; end: number; query: string }

// an "@word" the cursor is in or right after, where the @ starts the word (so emails and "a@b" do not open it)
export function mentionAt(text: string, caret: number): Mention | null {
  const before = text.slice(0, caret)
  const m = before.match(/(?:^|\s)@([^\s"]*)$/)
  if (!m) return null
  const start = caret - m[1].length - 1
  const tail = text.slice(caret).match(/^[^\s"]*/)![0]
  return { start, end: caret + tail.length, query: m[1] }
}

// A path with a space needs quotes so Claude reads it as one path.
export const quotePath = (p: string) => (/\s/.test(p) ? `"${p}"` : p)
export const mentionText = (p: string) => `@${quotePath(p)} `

// what picking a path does to the box: the @query becomes @path and a space, the caret goes after it
export function insertMention(text: string, m: Mention, path: string): { text: string; caret: number } {
  const ins = mentionText(path)
  return { text: text.slice(0, m.start) + ins + text.slice(m.end).replace(/^ /, ''), caret: m.start + ins.length }
}

// A file name that starts with the query first, then a name that contains it, then the path; shorter paths first.
export function filterPaths(paths: string[], q: string): string[] {
  const f = q.toLowerCase().replace(/\\/g, '/')
  if (!f) return paths
  const rank = (p: string): number => {
    const low = p.toLowerCase()
    const name = low.slice(low.lastIndexOf('/') + 1)
    if (name.startsWith(f)) return 0
    if (name.includes(f)) return 1
    if (low.includes(f)) return 2
    return -1
  }
  return paths
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.p.length - b.p.length || a.p.localeCompare(b.p))
    .map((x) => x.p)
}
