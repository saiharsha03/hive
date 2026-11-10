// The message box's pure parts: the "/" command menu (when it opens, what it lists, what Enter inserts)
// and the "ultrathink" keyword. Pure, so it can be tested without Electron.

export type Command = { name: string; description: string; argumentHint?: string; aliases?: string[]; builtin?: boolean }

// the menu is open while the box holds only "/word" (no space yet); the word is the filter
export function slashQuery(draft: string): string | null {
  const m = draft.match(/^\/(\S*)$/)
  return m ? m[1] : null
}

export const commandGroup = (c: Command) => (c.builtin ? 'Built-in' : c.name.includes(':') ? 'Plugin' : 'Skill / custom')

// Name starts with the filter first, then a name (or alias) that contains it, then a description match.
// Rows sharing a name are kept: the built-in one runs, so it is listed first.
export function filterCommands(cmds: Command[], q: string): Command[] {
  const f = q.toLowerCase()
  const rank = (c: Command): number => {
    const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase())
    if (!f) return 0
    if (names.some((n) => n.startsWith(f))) return 0
    // "review" finds "greptile:review": a namespaced command matches on the part after the colon too
    if (names.some((n) => n.split(':').at(-1)!.startsWith(f))) return 1
    if (names.some((n) => n.includes(f))) return 2
    if (c.description.toLowerCase().includes(f)) return 3
    return -1
  }
  return cmds
    .map((c, i) => ({ c, i, r: rank(c) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || Number(!!b.c.builtin) - Number(!!a.c.builtin) || a.c.name.localeCompare(b.c.name) || a.i - b.i)
    .map((x) => x.c)
}

// what picking a command puts in the box
export const insertCommand = (c: Command) => `/${c.name} `

// the keyword that asks for maximum effort on this one turn
export const ULTRATHINK = /\bultrathink\b/i
export const hasUltrathink = (text: string) => ULTRATHINK.test(text)

// the text cut into plain and keyword pieces, for highlighting in the box
export function ultrathinkParts(text: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  const re = /\bultrathink\b/gi
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out
}
