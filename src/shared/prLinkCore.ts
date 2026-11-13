// Pull request links: owner/repo#123, owner/repo #123 and github.com pull / issue URLs in Claude's replies become links,
// and the pull requests a thread opened (gh pr create prints the new PR's URL) show on the thread's header.
import { opensPr } from './changesCore'

export type PrRef = { repo: string; num: number; url: string }
export type Piece = string | { text: string; url: string }

const GH_URL = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)/i
// a URL (only a github pull or issue one is linked) | owner/repo#N or owner/repo #N | a bare #N
const REFS = /(https?:\/\/[^\s<>]+)|(?<![\w./\\-])([A-Za-z0-9][\w.-]*\/[\w.-]+) ?#(\d+)(?![\w/])|(?<![\w/\\&#])#(\d+)(?![\w/])/g

// ordinary word pairs: "and/or #5" is not a repo; only its #5 can link (as a bare #N)
const WORD_PAIRS = new Set(['and/or', 'either/or', 'yes/no', 'true/false', 'on/off', 'read/write', 'input/output', 'he/she', 'his/her', 'w/o', 'n/a', 'client/server', 'before/after'])

const issueUrl =(repo: string, num: string) => `https://github.com/${repo}/issues/${num}`

// a piece of plain text cut into text and links; a bare #N is linked only when the thread's repo is known
export function prPieces(text: string, repo?: string): Piece[] {
  const out: Piece[] = []
  let at = 0
  const push = (to: number, link?: { text: string; url: string }) => {
    if (to > at) out.push(text.slice(at, to))
    if (link) out.push(link)
  }
  for (const m of text.matchAll(REFS)) {
    const start = m.index
    if (m[1]) {
      const u = GH_URL.exec(m[1])
      if (!u) continue
      push(start, { text: u[0], url: u[0] })
      at = start + u[0].length
    } else if (m[2] && m[0].includes(' #') && WORD_PAIRS.has(m[2].toLowerCase())) {
      if (!repo) continue
      const hash = start + m[0].indexOf('#')
      push(hash, { text: `#${m[3]}`, url: issueUrl(repo, m[3]) })
      at = hash + m[3].length + 1
    } else if (m[2]) {
      push(start,{ text: m[0], url: issueUrl(m[2], m[3]) })
      at = start + m[0].length
    } else if (repo) {
      push(start, { text: m[0], url: issueUrl(repo, m[4]) })
      at = start + m[0].length
    }
  }
  push(text.length)
  return out.length ? out : [text]
}

// a markdown tree (mdast) with its text turned into links; code, inline code and existing links are left alone
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] }
export function linkPrTree(node: MdNode, repo?: string): void {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') return
  node.children = node.children.flatMap((c): MdNode[] => {
    if (c.type !== 'text') { linkPrTree(c, repo); return [c] }
    const pieces = prPieces(c.value ?? '', repo)
    if (pieces.length === 1 && typeof pieces[0] === 'string') return [c]
    return pieces.map((p) => (typeof p === 'string' ? { type: 'text', value: p } : { type: 'link', url: p.url, children: [{ type: 'text', value: p.text }] }))
  })
}

// the pull requests a thread opened, oldest first: from the output of each gh pr create that succeeded
type ToolLike = { kind: string; name?: string; input?: unknown; status?: string; output?: string }
export function threadPrs(items: ToolLike[]): PrRef[] {
  const out: PrRef[] = []
  for (const it of items) {
    if (it.kind !== 'tool' || it.status !== 'done' || !opensPr(it.name, it.input)) continue
    const m = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i.exec(it.output ?? '')
    if (m && !out.some((p) => p.url === m[0])) out.push({ repo: m[1], num: Number(m[2]), url: m[0] })
  }
  return out
}
