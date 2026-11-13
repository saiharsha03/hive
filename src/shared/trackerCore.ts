// The Board: your Jira tickets as columns by status, and a thread started from one. Pure logic (the settings it needs,
// the search, a Jira issue as a card, the columns, the prepared first message). No I/O, so it can be tested without
// Electron or Jira. Read-only: nothing here or in main/tracker.ts writes to Jira.

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {})
const str = (x: unknown): string => (typeof x === 'string' ? x : '')
const list = (xs: string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

// ---------- settings ----------

// HIVE_TRACKER_SITE (https://yourteam.atlassian.net), HIVE_TRACKER_EMAIL, and the API token: HIVE_TRACKER_TOKEN in the
// .env (a credential, so never in the settings store) or HIVE_TRACKER_TOKEN_FILE, a file that holds only the token
export type TrackerConfig =
  | { ok: true; origin: string; email: string; token: string; tokenFile: string }
  | { ok: false; message: string }

// the site's origin, https only: the token is sent there
export function trackerOrigin(url: string): string | null {
  try { const u = new URL(url.trim()); return u.protocol === 'https:' && u.hostname ? u.origin : null } catch { return null }
}

export function trackerConfig(env: Record<string, string | undefined>): TrackerConfig {
  const v = (k: string) => (env[k] ?? '').trim()
  const url = v('HIVE_TRACKER_SITE'), email = v('HIVE_TRACKER_EMAIL'), token = v('HIVE_TRACKER_TOKEN'), tokenFile = v('HIVE_TRACKER_TOKEN_FILE')
  const missing = [!url && 'the Jira site', !email && 'your Jira email', !token && !tokenFile && 'the API token file'].filter(Boolean) as string[]
  if (missing.length) return { ok: false, message: `Set ${list(missing)} in Settings, under General, to see your Jira tickets here.` }
  const origin = trackerOrigin(url)
  if (!origin) return { ok: false, message: 'The Jira site in Settings, under General, must be an https address such as https://yourteam.atlassian.net.' }
  return { ok: true, origin, email, token, tokenFile }
}

// ---------- the search ----------

export const DONE_DAYS = 14
export const PAGE_SIZE = 100
export const MAX_PAGES = 10 // a stop for a search that never ends; the page says when it was reached
export const FIELDS = ['summary', 'status', 'issuetype', 'priority', 'project', 'updated', 'description']

// mine and open. Done work is left out: the board is for what is still to do (doneDays > 0 adds what was finished lately)
export const buildJql = (doneDays = 0): string => {
  const days = Math.max(0, Math.round(doneDays))
  return `assignee = currentUser() AND ${days ? `(statusCategory != Done OR statusCategoryChangedDate >= -${days}d)` : 'statusCategory != Done'} ORDER BY updated DESC`
}

export function searchUrl(origin: string, jql: string, nextPageToken = ''): string {
  const q = new URLSearchParams({ jql, fields: FIELDS.join(','), maxResults: String(PAGE_SIZE) })
  if (nextPageToken) q.set('nextPageToken', nextPageToken)
  return `${origin}/rest/api/3/search/jql?${q}`
}

// a refused request in plain words; Jira's own reason is added when it gives a short one (never the request)
export function httpError(status: number, body = ''): string {
  if (status === 401 || status === 403) return `Jira refused the token (${status}). Check the email and the API token in Settings.`
  let why = ''
  try { const m = obj(JSON.parse(body)).errorMessages; why = str(Array.isArray(m) ? m[0] : '') } catch { /* not JSON */ }
  return `Jira answered ${status}${why ? `: ${why.slice(0, 160)}` : ''}.`
}
// a request that never got an answer; errorName = the thrown error's name
export const fetchFailure = (errorName: string, origin: string, seconds: number): string =>
  errorName === 'TimeoutError' || errorName === 'AbortError' ? `Jira did not answer within ${seconds} seconds.` : `Could not reach ${origin.replace(/^https:\/\//, '')}.`

// ---------- a Jira description (Atlassian Document Format) as plain text ----------

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'panel', 'bulletList', 'orderedList', 'table', 'mediaSingle', 'mediaGroup', 'expand', 'nestedExpand', 'taskList', 'decisionList'])

function adfNode(n: unknown): string {
  const o = obj(n)
  const attrs = obj(o.attrs)
  const kids = Array.isArray(o.content) ? o.content : []
  const inner = () => kids.map(adfNode).join('')
  switch (str(o.type)) {
    case 'text': return str(o.text)
    case 'hardBreak': return '\n'
    case 'rule': return '\n\n---\n\n'
    case 'mention': case 'status': return str(attrs.text)
    case 'emoji': return str(attrs.text) || str(attrs.shortName)
    case 'inlineCard': case 'blockCard': case 'embedCard': return str(attrs.url)
    case 'date': { const t = Number(attrs.timestamp); return Number.isFinite(t) && attrs.timestamp ? new Date(t).toISOString().slice(0, 10) : '' }
    case 'media': return ''
    case 'listItem': case 'taskItem': case 'decisionItem': return `- ${inner().trim().replace(/\n/g, '\n  ')}\n`
    case 'orderedList': return `${kids.map((k, i) => adfNode(k).replace(/^- /, `${i + (Number(attrs.order) || 1)}. `)).join('')}\n`
    case 'tableRow': return `${kids.map((k) => adfNode(k).trim().replace(/\n+/g, ' ')).join(' | ')}\n`
    // a node this does not know still gives its text, so a new Jira node type never loses the words inside it
    default: { const t = inner() || str(o.text) || str(attrs.text); return BLOCKS.has(str(o.type)) ? `${t}\n\n` : t }
  }
}

// also takes the plain string older Jira versions send; anything else is no description
export function adfToText(doc: unknown): string {
  const raw = typeof doc === 'string' ? doc : adfNode(doc)
  return raw.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------- cards and columns ----------

export type ColumnId = 'todo' | 'progress' | 'review' | 'done'
export type Card = {
  key: string; summary: string; type: string; priority: string; project: string; projectName: string
  status: string; column: ColumnId; updated: number; url: string; description: string
}
export const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'todo', label: 'To do' }, { id: 'progress', label: 'In progress' }, { id: 'review', label: 'In review' }, { id: 'done', label: 'Done' },
]

// Jira has three status categories (new, indeterminate, done); a status with "review" in its name gets its own column
export function columnOf(categoryKey: string, status: string): ColumnId {
  if (categoryKey === 'done') return 'done'
  if (/\breview/i.test(status)) return 'review'
  return categoryKey === 'new' ? 'todo' : 'progress'
}

// Jira writes "2026-11-10T14:03:11.123+0000": the offset gets its colon so every runtime reads it
const time = (s: string): number => { const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')); return Number.isFinite(t) ? t : 0 }

export function mapIssue(issue: unknown, origin: string): Card | null {
  const i = obj(issue), f = obj(i.fields)
  const key = str(i.key).trim()
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key)) return null
  const status = obj(f.status), project = obj(f.project)
  const name = str(status.name)
  return {
    key, summary: str(f.summary).trim(), type: str(obj(f.issuetype).name), priority: str(obj(f.priority).name),
    project: str(project.key) || key.replace(/-\d+$/, ''), projectName: str(project.name),
    status: name, column: columnOf(str(obj(status.statusCategory).key), name), updated: time(str(f.updated)),
    url: `${origin}/browse/${key}`, description: adfToText(f.description),
  }
}

// the filter box: key, summary or project, as typed
export function filterCards(cards: Card[], query: string): Card[] {
  const q = query.trim().toLowerCase()
  return q ? cards.filter((c) => [c.key, c.summary, c.project, c.projectName].some((s) => s.toLowerCase().includes(q))) : cards
}

// To do, In progress, In review (only when a status like that exists), Done; the newest change first in each
// One column per real Jira status the cards are in ("Back Log", "To Do", "In Progress", "In Prod - Feature flag not yet
// enabled"), not per status category: the stage is what the board is read for. Order: the backlog, then the rest of
// what has not started, then work in hand, then review, then what is already in production; done (when asked for) last.
const stageRank = (c: Card): number => {
  const n = c.status.toLowerCase()
  if (c.column === 'done') return 6
  if (/back ?log/.test(n)) return 0
  if (c.column === 'todo') return 1
  if (/\bprod|deploy|released|feature flag/.test(n)) return 5
  if (c.column === 'review' || /\bqa\b|review|test/.test(n)) return 4
  if (/block|hold|wait/.test(n)) return 3
  return 2
}
// the stage a status belongs to, for its colour: backlog, todo, doing, blocked, review, prod, done
export const STAGES = ['backlog', 'todo', 'doing', 'blocked', 'review', 'prod', 'done'] as const
export const stageOf = (c: Card): (typeof STAGES)[number] => STAGES[stageRank(c)]
// what kind of ticket it is, for the card's type word: bug, story, task, epic or other
export const typeTone = (type: string): 'bug' | 'story' | 'task' | 'epic' | 'other' => {
  const t = type.toLowerCase()
  return /bug|defect|incident/.test(t) ? 'bug' : /story|feature/.test(t) ? 'story' : /epic/.test(t) ? 'epic' : /task|spike|chore/.test(t) ? 'task' : 'other'
}
export const isUrgent = (priority: string): boolean => /high|critical|blocker|urgent/i.test(priority)
export function columnsOf(cards: Card[]): { id: string; label: string; stage: (typeof STAGES)[number]; cards: Card[] }[] {
  const by = new Map<string, Card[]>()
  for (const c of cards) { const k = c.status || 'No status'; by.set(k, [...(by.get(k) ?? []), c]) }
  return [...by.entries()]
    .map(([label, list]) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'none', label, stage: stageOf(list[0]), cards: list.sort((x, y) => y.updated - x.updated) }))
    .sort((x, y) => stageRank(x.cards[0]) - stageRank(y.cards[0]) || x.label.localeCompare(y.label))
}

// the column is the status now, so a card has nothing more to say about it
export const statusNote = (_card: Card): string => ''

// ---------- a thread from a card ----------

export const DESCRIPTION_MAX = 4000

// cut at a line or word end when one is near, never mid-word for nothing
export function trimDescription(text: string, max = DESCRIPTION_MAX): { text: string; cut: boolean } {
  const t = text.trim()
  if (t.length <= max) return { text: t, cut: false }
  const head = t.slice(0, max)
  const at = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '))
  return { text: (at > max / 2 ?head.slice(0, at) : head).trimEnd(), cut: true }
}

export const threadTitle = (card: Pick<Card, 'key' | 'summary'>): string => `${card.key} ${card.summary}`.trim()

// the new thread's first message: prepared in the composer, not sent
export function firstMessage(card: Card, max = DESCRIPTION_MAX): string {
  const d = trimDescription(card.description, max)
  return [
    threadTitle(card),
    d.text || 'The ticket has no description.',
    ...(d.cut ? [`(Description cut at ${max} characters; the ticket has the rest.)`] : []),
    card.url,
    'Read the ticket and propose a plan before changing anything.',
  ].join('\n\n')
}

// the open thread already started for this ticket: its title starts with the key (SCRUM-1 is not SCRUM-12)
export function threadFor<T extends { id: string; title: string }>(key: string, threads: T[]): T | null {
  const k = key.toLowerCase()
  return threads.find((t) => { const s = t.title.trim().toLowerCase(); return s.startsWith(k) && !/[a-z0-9]/.test(s.charAt(k.length)) }) ?? null
}

// ---------- what the page gets from main: the cards, never the token ----------

export type Board =
  | { state: 'unset'; message: string }
  | { state: 'error'; message: string }
  | { state: 'ok'; cards: Card[]; at: number; more: boolean }
