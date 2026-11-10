// Keyword (BM25, MiniSearch) search over the sessions the sidebar lists. Only user and assistant words are indexed,
// one chunk per message (long ones split). The index lives in userData/search (manifest.json, chunks.jsonl) keyed by
// session path + size + mtime, with the byte offset indexed so far: a transcript that grew is indexed from there on,
// not again from the start. A transcript whose thread is working is left until its turn ends. The work runs on the main
// process but yields between sessions and between chunks of a long one; the index is saved at most every SAVE_EVERY
// and when Hive quits (saveSearchNow).
import { app, BrowserWindow } from 'electron'
import MiniSearch from 'minisearch'
import { createReadStream, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { chunkText, messageTexts, trimSnippet, type SearchResult, type SessionHit, type SessionMeta } from './searchCore'
import { listSessions, sessionStamp, type SessionInfo } from './sessions'
import { readLines } from './lines'

const VERSION = 3 // 1 also stored embeddings; 2 had no byte offset (re-read in full once)
const SAVE_EVERY = 5 * 60_000

// offset: the bytes indexed so far (up to the last whole line)
type Entry = { path: string; id: string; size: number; mtime: number; offset: number; texts: string[]; ids: number[] }
type Manifest = { version: number; sessions: { path: string; id: string; size: number; mtime: number; offset: number }[] }
export type SearchStatus = { indexed: number; total: number; done: boolean }

const entries = new Map<string, Entry>()
const refs = new Map<number, { path: string; i: number }>() // chunk id -> where it lives
let nextId = 1
const bm25 = new MiniSearch<{ id: number; text: string }>({ fields: ['text'], searchOptions: { prefix: true, fuzzy: 0.2 } })

let list: SessionInfo[] = []
let started = false
let running = false
let rerun = false
let dirty = false
let saving: Promise<void> | null = null
let lastSave = Date.now()
const progress = { indexed: 0, total: 0, done: false }

const dir = () => join(app.getPath('userData'), 'search')
// a transcript whose thread is working right now (chat.ts): indexed after its turn ends instead
let busyPath: (path: string) => boolean = () => false
export const setSearchBusy = (f: (path: string) => boolean) => { busyPath = f }
// the assistant blocks already indexed near the end of each transcript, so a streamed message that continues past the
// indexed offset is not indexed twice (kept in memory only)
const seenTail = new Map<string, Set<string>>()
const yieldNow = () => new Promise<void>((r) => setImmediate(r))

export const searchStatus = (): SearchStatus => ({ ...progress })
function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('search:progress', searchStatus())
}

// ---- index ----
function register(e: Entry): { id: number; text: string }[] {
  e.ids = e.texts.map(() => nextId++)
  e.ids.forEach((id, i) => refs.set(id, { path: e.path, i }))
  entries.set(e.path, e)
  return e.texts.map((text, i) => ({ id: e.ids[i], text }))
}
// more chunks for a session already in the index
function extend(e: Entry, texts: string[]): { id: number; text: string }[] {
  const docs = texts.map((text, k) => ({ id: nextId++, text, i: e.texts.length + k }))
  for (const d of docs) { e.ids.push(d.id); e.texts.push(d.text); refs.set(d.id, { path: e.path, i: d.i }) }
  return docs.map(({ id, text }) => ({ id, text }))
}

function remove(path: string): void {
  const e = entries.get(path)
  if (!e) return
  for (const id of e.ids) { bm25.discard(id); refs.delete(id) }
  entries.delete(path)
}

// the words of a transcript from byte `from` on, and where the last whole line ended
async function extract(path: string, from: number, seen: Set<string>): Promise<{ texts: string[]; offset: number }> {
  const texts: string[] = []
  const offset = await readLines(path, from, (line) => {
    if (!line.startsWith('{') || !(line.includes('"type":"user"') || line.includes('"type":"assistant"'))) return
    let e: any
    try { e = JSON.parse(line) } catch { return }
    for (const t of messageTexts(e, seen)) texts.push(...chunkText(t))
  })
  // only the newest keys matter (a streamed message's lines are next to each other)
  if (seen.size > 400) { const keep = [...seen].slice(-200); seen.clear(); for (const k of keep) seen.add(k) }
  return { texts, offset }
}

let loading: Promise<void> | null = null
const load = (): Promise<void> => (loading ??= (async () => {
  // the embeddings and model files the semantic search left behind
  await rm(join(dir(), 'embeddings.bin'), { force: true }).catch(() => {})
  await rm(join(app.getPath('userData'), 'models'), { recursive: true, force: true }).catch(() => {})
  try {
    const m: Manifest = JSON.parse(await readFile(join(dir(), 'manifest.json'), 'utf8'))
    // version 2 indexed each transcript whole: as far as its size then
    if (m.version === 2) for (const x of m.sessions) x.offset = x.size
    else if (m.version !== VERSION) return
    const docs: { id: number; text: string }[] = []
    let n = 0
    for await (const line of createInterface({ input: createReadStream(join(dir(), 'chunks.jsonl'), { encoding: 'utf8' }), crlfDelay: Infinity })) {
      const s = m.sessions[n++]
      if (!s) break
      docs.push(...register({ path: s.path, id: s.id, size: s.size, mtime: s.mtime, offset: s.offset, texts: JSON.parse(line), ids: [] }))
    }
    await bm25.addAllAsync(docs, { chunkSize: 1000 })
  } catch {
    // no index yet, or an unreadable one: start empty
    for (const p of [...entries.keys()]) remove(p)
    bm25.removeAll()
  }
})())

function save(): Promise<void> {
  return (saving ??= (async () => {
    try {
      await mkdir(dir(), { recursive: true })
      const snap = [...entries.values()].map((e) => ({ e, texts: e.texts }))
      const jsonl = await open(join(dir(), 'chunks.jsonl.tmp'), 'w')
      for (const { texts } of snap) await jsonl.write(JSON.stringify(texts) + '\n')
      await jsonl.close()
      const manifest: Manifest = { version: VERSION, sessions: snap.map(({ e }) => ({ path: e.path, id: e.id, size: e.size, mtime: e.mtime, offset: e.offset })) }
      const mf = await open(join(dir(), 'manifest.json.tmp'), 'w')
      await mf.writeFile(JSON.stringify(manifest))
      await mf.close()
      await rename(join(dir(), 'chunks.jsonl.tmp'), join(dir(), 'chunks.jsonl'))
      await rename(join(dir(), 'manifest.json.tmp'), join(dir(), 'manifest.json'))
      dirty = false
      lastSave = Date.now()
    } catch (e) {
      console.error('search: could not save the index:', e)
    } finally {
      saving = null
    }
  })())
}

// Hive is quitting: the index as it is now, written at once (a few MB to a few tens of MB)
export function saveSearchNow(): void {
  if (!dirty || !entries.size) return
  try {
    mkdirSync(dir(), { recursive: true })
    const all = [...entries.values()]
    writeFileSync(join(dir(), 'chunks.jsonl.tmp'), all.map((e) => JSON.stringify(e.texts)).join('\n') + '\n')
    const manifest: Manifest = { version: VERSION, sessions: all.map((e) => ({ path: e.path, id: e.id, size: e.size, mtime: e.mtime, offset: e.offset })) }
    writeFileSync(join(dir(), 'manifest.json.tmp'), JSON.stringify(manifest))
    renameSync(join(dir(), 'chunks.jsonl.tmp'), join(dir(), 'chunks.jsonl'))
    renameSync(join(dir(), 'manifest.json.tmp'), join(dir(), 'manifest.json'))
    dirty = false
  } catch (e) { console.error('search: could not save the index at quit:', e) }
}

// A transcript that only grew (same session, larger) is indexed from where the last pass stopped; anything else
// (new, rewritten, shorter) from the start
export async function indexOne(s: Pick<SessionInfo, 'path' | 'id'>, size: number, mtime: number): Promise<void> {
  const e = entries.get(s.path)
  if (e && e.id === s.id && size >= e.offset && e.offset > 0 && size >= e.size) {
    const seen = seenTail.get(s.path) ?? new Set<string>()
    const { texts, offset } = await extract(s.path, e.offset, seen)
    seenTail.set(s.path, seen)
    if (entries.get(s.path) !== e) return // dropped meanwhile
    if (texts.length) bm25.addAll(extend(e, texts))
    Object.assign(e, { size, mtime, offset })
    dirty = true
    return
  }
  const seen = new Set<string>()
  const { texts, offset } = await extract(s.path, 0, seen)
  seenTail.set(s.path, seen)
  remove(s.path)
  bm25.addAll(register({ path: s.path, id: s.id, size, mtime, offset, texts, ids: [] }))
  dirty = true
}

async function reconcile(): Promise<void> {
  await load()
  const keep = new Set(list.map((s) => s.path))
  for (const p of [...entries.keys()]) if (!keep.has(p)) { remove(p); dirty = true }

  // the session list already knows each transcript's size and time; only one it has none for is looked at here
  const stats = new Map<string, { size: number; mtime: number }>()
  for (let i = 0; i < list.length; i += 32) {
    await Promise.all(list.slice(i, i + 32).map(async (s) => {
      const known = sessionStamp(s.path)
      if (known) { stats.set(s.path, known); return }
      try { const st = await stat(s.path); stats.set(s.path, { size: st.size, mtime: st.mtimeMs }) } catch { /* deleted meanwhile */ }
    }))
  }
  // a working thread's transcript waits for its turn to end (it changes with every line meanwhile)
  const todo = list.filter((s) => {
    const st = stats.get(s.path)
    if (!st || busyPath(s.path)) return false
    const e = entries.get(s.path)
    return !e || e.size !== st.size || e.mtime !== st.mtime
  })
  progress.total = list.length
  progress.indexed = list.length - todo.length
  progress.done = todo.length === 0
  broadcast()

  for (const s of todo) {
    const st = stats.get(s.path)!
    try { await indexOne(s, st.size, st.mtime) } catch (e) { console.error('search: could not index', s.path, e) }
    progress.indexed++
    progress.done = progress.indexed >= progress.total
    broadcast()
    if (dirty && Date.now() - lastSave > SAVE_EVERY) await save()
    await yieldNow() // the window's requests go first
  }
  if (dirty && Date.now() - lastSave > SAVE_EVERY) await save()
  else if (dirty) scheduleSave()
}

// a pass that changed little leaves the save for later (at most every SAVE_EVERY; Hive quitting saves at once)
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; if (dirty) void save() }, Math.max(1000, SAVE_EVERY - (Date.now() - lastSave)))
  saveTimer.unref?.()
}

async function kick(): Promise<void> {
  if (running) { rerun = true; return }
  running = true
  try {
    do {
      rerun = false
      await reconcile().catch((e) => console.error('search: indexing failed:', e))
    } while (rerun)
  } finally {
    running = false
  }
}

// The sidebar's session list changed: index new or changed sessions, drop deleted ones.
export function syncSearch(sessions: SessionInfo[]): void {
  list = sessions
  if (started) void kick()
}

// A few seconds after launch, so the window comes up first.
export function startSearch(): void {
  setTimeout(() => {
    started = true
    void (async () => {
      if (!list.length) list = await listSessions()
      void kick()
    })().catch((e) => console.error('search: start failed:', e))
    // every few minutes every transcript is checked again (sessions the terminal wrote, a thread that kept working)
    setInterval(() => { void listSessions({ full: true }).then(syncSearch).catch(() => {}) }, 5 * 60_000).unref()
  }, 5000)
}

// ---- query ----
type Scored = { path: string; i: number; score: number; terms: string[] }

async function bm25Hits(text: string, scope: Entry | null): Promise<Scored[]> {
  await load()
  const hits: Scored[] = []
  for (const r of bm25.search(text, { filter: scope ? (r) => refs.get(r.id)?.path === scope.path : undefined })) {
    const ref = refs.get(r.id)
    if (ref) hits.push({ ...ref, score: r.score, terms: r.terms })
  }
  return hits
}

const indexing = () => (progress.done || !progress.total ? null : { indexed: progress.indexed, total: progress.total })

export async function searchSessions(text: string, limit = 30): Promise<SearchResult> {
  const terms = text.split(/\W+/).filter(Boolean)
  // the best chunk per session (hits are best-first)
  const best = new Map<string, Scored>()
  for (const h of await bm25Hits(text, null)) if (!best.has(h.path)) best.set(h.path, h)
  const results: SessionHit[] = []
  for (const h of [...best.values()].slice(0, limit)) {
    const e = entries.get(h.path)
    if (e) results.push({ sessionId: e.id, score: h.score, snippet: trimSnippet(e.texts[h.i], [...h.terms, ...terms]) })
  }
  return { indexing: indexing(), results }
}

// The best matching chunks of one session, in full; null when the session is not in the index.
export async function searchInSession(text: string, sessionId: string, limit: number): Promise<{ indexing: SearchResult['indexing']; chunks: { text: string }[] } | null> {
  await load()
  const scope = [...entries.values()].find((e) => e.id === sessionId)
  if (!scope) return null
  const chunks = (await bm25Hits(text, scope)).slice(0, limit).map((h) => ({ text: scope.texts[h.i] }))
  return { indexing: indexing(), chunks }
}

export function sessionMeta(id: string): SessionMeta | undefined {
  const s = list.find((x) => x.id === id)
  return s && { id: s.id, title: s.title, project: s.project, updated: s.updated, path: s.path }
}
