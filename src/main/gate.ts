// The PR gate, read live for a thread's checkout: the checklist the workspace's review gate enforces
// (.claude/known-misses.md, found by walking up from the checkout) and, for the commit now at HEAD, what the review
// marker (~/.claude/review-gate/<sha>.md) says about each item. Read only: the gate itself is the workspace's own hook.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type GateItem = { id: string; title: string; state: 'PASS' | 'FIXED' | 'NA' | ''; evidence: string }
export type Gate = {
  dir: string
  sha: string | null
  branch: string | null
  checklist: string | null // the checklist file found, null when the checkout has none above it
  marker: boolean // a review marker exists for this exact commit
  markerAt: number | null
  about: { repo: string; base: string; review: string }
  items: GateItem[]
  done: number // items with a PASS, FIXED or NA line
  error?: string
}

const git = (cwd: string, args: string[]): Promise<string> =>
  new Promise((res) => execFile('git', args, { cwd, timeout: 8000, windowsHide: true }, (err, out) => res(err ? '' : String(out).trim())))

function findChecklist(dir: string): string | null {
  let d = dir
  for (let i = 0; i < 12; i++) {
    const p = join(d, '.claude', 'known-misses.md')
    if (existsSync(p)) return p
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  return null
}

const HEADING = /^#{2,4}\s*(K\d+)\s*[—–:-]+\s*(.+?)\s*$/gm
const LINE = /^\s*[-*]?\s*(K\d+)\s*:\s*(PASS|FIXED|NA)\b\s*[—–:-]+\s*(.+)$/gm
const field = (text: string, name: string) => text.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''

export async function readGate(dir: string): Promise<Gate> {
  const base: Gate = { dir, sha: null, branch: null, checklist: null, marker: false, markerAt: null, about: { repo: '', base: '', review: '' }, items: [], done: 0 }
  if (!dir || !existsSync(dir)) return { ...base, error: 'This thread has no folder.' }
  const [sha, branch] = await Promise.all([git(dir, ['rev-parse', 'HEAD']), git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])])
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ...base, error: 'Not a git checkout.' }
  const checklist = findChecklist(dir)
  const titles: [string, string][] = []
  if (checklist) { try { for (const m of readFileSync(checklist, 'utf8').matchAll(HEADING)) titles.push([m[1], m[2]]) } catch { /* unreadable: no titles */ } }
  const file = join(homedir(), '.claude', 'review-gate', `${sha}.md`)
  const said = new Map<string, { state: GateItem['state']; evidence: string }>()
  let text = ''
  let markerAt: number | null = null
  if (existsSync(file)) {
    try { text = readFileSync(file, 'utf8'); markerAt = statSync(file).mtimeMs } catch { /* read next time */ }
    for (const m of text.matchAll(LINE)) said.set(m[1], { state: m[2] as GateItem['state'], evidence: m[3].trim() })
  }
  // the checklist's items in its order; a marker line for an item the checklist does not name still shows
  const ids = [...titles.map(([id]) => id), ...[...said.keys()].filter((id) => !titles.some(([t]) => t === id))]
  const items: GateItem[] = ids.map((id) => ({ id, title: titles.find(([t]) => t === id)?.[1] ?? '', state: said.get(id)?.state ?? '', evidence: said.get(id)?.evidence ?? '' }))
  return {
    ...base, sha, branch: branch || null, checklist, marker: !!text, markerAt,
    about: { repo: field(text, 'repo'), base: field(text, 'base'), review: field(text, 'review') },
    items, done: items.filter((i) => i.state).length,
  }
}
