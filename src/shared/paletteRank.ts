// Ranking for the Ctrl+K palette: label starts with the text, then a word of the label starts with it, then anywhere.
// 0 / 1 / 2 (lower is better), null when it does not match.
export function matchRank(label: string, q: string): number | null {
  const l = label.toLowerCase()
  const t = q.trim().toLowerCase()
  if (!t) return 0
  if (l.startsWith(t)) return 0
  // a word start: after a space, slash, dot, dash or underscore
  for (let at = l.indexOf(t); at >= 0; at = l.indexOf(t, at + 1)) if (/[\s/\\._-]/.test(l[at - 1])) return 1
  return l.includes(t) ? 2 : null
}

// a file matches on its name first, then on its relative path (always the weakest rank)
export function fileRank(rel: string, q: string): number | null {
  const name = rel.slice(rel.search(/[^/\\]*$/))
  return matchRank(name, q) ?? (matchRank(rel, q) === null ? null : 2)
}
