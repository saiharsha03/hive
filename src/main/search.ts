// Hybrid search over the sessions the sidebar lists: BM25 (MiniSearch) + local MiniLM embeddings, fused with RRF.
// Only user and assistant words are indexed, one chunk per message (long ones split). The index lives in
// userData/search (manifest.json, chunks.jsonl, embeddings.bin) keyed by session path + size + mtime.
// Embedding runs in a worker thread so neither the main process nor the UI waits on it.
import { app, BrowserWindow } from 'electron'
import MiniSearch from 'minisearch'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Worker } from 'node:worker_threads'
import { chunkText, cosineTopK, messageTexts, rrf, trimSnippet, type SearchResult, type SessionHit, type SessionMeta } from './searchCore'
import { listSessions, type SessionInfo } from './sessions'

const DIM = 384
const VERSION = 1
const BATCH = 16 // chunks per embedding call: small, so a query slips in between two batches
const SEM_MIN = 0.2 // below this cosine a chunk is noise, not a semantic match
const SAVE_EVERY = 60_000

type Entry = { path: string; id: string; size: number; mtime: number; texts: string[]; ids: number[]; vecs: Float32Array | null }
type Manifest = { version: number; dim: number; floats: number; sessions: { path: string; id: string; size: number; mtime: number; vecs: boolean }[] }
export type SearchStatus = { indexed: number; total: number; model: 'idle' | 'loading' | 'ready' | 'failed'; done: boolean }

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

// ---- worker ----
let worker: Worker | null = null
let model: SearchStatus['model'] = 'idle'
let reqId = 0
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>()

export const searchStatus = (): SearchStatus => ({ ...progress, model })
function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('search:progress', searchStatus())
}

function call(msg: { type: 'init' } | { type: 'embed'; texts: string[] }): Promise<{ vecs?: Float32Array }> {
  if (!worker) return Promise.reject(new Error('no worker'))
  return new Promise((res, rej) => {
    const id = ++reqId
    pending.set(id, { res, rej })
    worker!.postMessage({ ...msg, id })
  })
}

function fail(e: unknown): void {
  if (model === 'failed') return
  model = 'failed'
  console.error('search: embedding model unavailable, keyword search only:', e)
  for (const p of pending.values()) p.rej(new Error('worker stopped'))
  pending.clear()
  void worker?.terminate()
  worker = null
  broadcast()
}

function spawn(): void {
  model = 'loading'
  worker = new Worker(join(__dirname, 'searchWorker.js'), { workerData: { cacheDir: join(app.getPath('userData'), 'models') } })
  worker.unref()
  worker.on('message', (m: { id: number; ok: boolean; vecs?: Float32Array; error?: string }) => {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (m.ok) p?.res(m)
    else p?.rej(new Error(m.error))
  })
  worker.on('error', fail)
  worker.on('exit', () => fail(new Error('worker exited')))
  call({ type: 'init' }).then(() => { model = 'ready'; broadcast() }, fail)
}

async function embed(texts: string[]): Promise<Float32Array | null> {
  if (model === 'failed' || !texts.length) return model === 'failed' ? null : new Float32Array(0)
  const out = new Float32Array(texts.length * DIM)
  try {
    for (let i = 0; i < texts.length; i += BATCH) out.set((await call({ type: 'embed', texts: texts.slice(i, i + BATCH) })).vecs!, i * DIM)
    return out
  } catch (e) {
    fail(e)
    return null
  }
}

// ---- index ----
function register(e: Entry): { id: number; text: string }[] {
  e.ids = e.texts.map(() => nextId++)
  e.ids.forEach((id, i) => refs.set(id, { path: e.path, i }))
  entries.set(e.path, e)
  return e.texts.map((text, i) => ({ id: e.ids[i], text }))
}

function remove(path: string): void {
  const e = entries.get(path)
  if (!e) return
  for (const id of e.ids) { bm25.discard(id); refs.delete(id) }
  entries.delete(path)
}

async function extract(path: string): Promise<string[]> {
  const texts: string[] = []
  const seen = new Set<string>()
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.startsWith('{') || !(line.includes('"type":"user"') || line.includes('"type":"assistant"'))) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    for (const t of messageTexts(e, seen)) texts.push(...chunkText(t))
  }
  return texts
}

let loading: Promise<void> | null = null
const load = (): Promise<void> => (loading ??= (async () => {
  try {
    const m: Manifest = JSON.parse(await readFile(join(dir(), 'manifest.json'), 'utf8'))
    if (m.version !== VERSION || m.dim !== DIM) return
    const raw = await readFile(join(dir(), 'embeddings.bin'))
    if (raw.length !== m.floats * 4) return
    const all = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length))
    const docs: { id: number; text: string }[] = []
    let n = 0
    let off = 0
    for await (const line of createInterface({ input: createReadStream(join(dir(), 'chunks.jsonl'), { encoding: 'utf8' }), crlfDelay: Infinity })) {
      const s = m.sessions[n++]
      if (!s) break
      const texts: string[] = JSON.parse(line)
      const vecs = s.vecs ? all.subarray(off, off + texts.length * DIM) : null
      if (vecs) off += texts.length * DIM
      docs.push(...register({ path: s.path, id: s.id, size: s.size, mtime: s.mtime, texts, ids: [], vecs }))
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
      const snap = [...entries.values()].map((e) => ({ e, vecs: e.vecs, texts: e.texts }))
      const bin = await open(join(dir(), 'embeddings.bin.tmp'), 'w')
      const jsonl = await open(join(dir(), 'chunks.jsonl.tmp'), 'w')
      let floats = 0
      for (const { vecs, texts } of snap) {
        if (vecs?.length) { await bin.write(Buffer.from(vecs.buffer, vecs.byteOffset, vecs.byteLength)); floats += vecs.length }
        await jsonl.write(JSON.stringify(texts) + '\n')
      }
      await bin.close()
      await jsonl.close()
      const manifest: Manifest = { version: VERSION, dim: DIM, floats, sessions: snap.map(({ e, vecs }) => ({ path: e.path, id: e.id, size: e.size, mtime: e.mtime, vecs: !!vecs })) }
      await mkdir(dir(), { recursive: true })
      const mf = await open(join(dir(), 'manifest.json.tmp'), 'w')
      await mf.writeFile(JSON.stringify(manifest))
      await mf.close()
      await rename(join(dir(), 'embeddings.bin.tmp'), join(dir(), 'embeddings.bin'))
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

async function indexOne(s: SessionInfo, size: number, mtime: number): Promise<void> {
  const old = entries.get(s.path)
  const unchanged = old && old.size === size && old.mtime === mtime
  const texts = unchanged ? old.texts : await extract(s.path)
  let e = old
  if (!unchanged) {
    remove(s.path)
    e = { path: s.path, id: s.id, size, mtime, texts, ids: [], vecs: null }
    bm25.addAll(register(e))
  }
  e!.vecs = await embed(texts)
  dirty = true
}

async function reconcile(): Promise<void> {
  await load()
  const keep = new Set(list.map((s) => s.path))
  for (const p of [...entries.keys()]) if (!keep.has(p)) { remove(p); dirty = true }

  const stats = new Map<string, { size: number; mtime: number }>()
  for (let i = 0; i < list.length; i += 32) {
    await Promise.all(list.slice(i, i + 32).map(async (s) => {
      try { const st = await stat(s.path); stats.set(s.path, { size: st.size, mtime: st.mtimeMs }) } catch { /* deleted meanwhile */ }
    }))
  }
  const todo = list.filter((s) => {
    const st = stats.get(s.path)
    if (!st) return false
    const e = entries.get(s.path)
    return !e || e.size !== st.size || e.mtime !== st.mtime || (!e.vecs && model !== 'failed')
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
  }
  if (dirty) await save()
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
    spawn()
    void (async () => {
      if (!list.length) list = await listSessions()
      void kick()
    })().catch((e) => console.error('search: start failed:', e))
    setInterval(() => { void listSessions().then(syncSearch).catch(() => {}) }, 5 * 60_000).unref()
  }, 5000)
}

// ---- query ----
type Scored = { path: string; i: number; score: number; terms?: string[] }

async function gather(text: string, scope: Entry | null, k: number): Promise<{ mode: 'hybrid' | 'bm25'; sem: Scored[]; bm: Scored[]; terms: string[] }> {
  await load()
  let qv: Float32Array | null = null
  if (model === 'ready') {
    try { qv = (await call({ type: 'embed', texts: [text] })).vecs ?? null } catch { qv = null }
  }
  const sem: Scored[] = []
  if (qv) {
    for (const e of scope ? [scope] : entries.values()) {
      if (e.vecs?.length) for (const h of cosineTopK(qv, e.vecs, DIM, k)) if (h.score >= SEM_MIN) sem.push({ path: e.path, i: h.index, score: h.score })
    }
    sem.sort((a, b) => b.score - a.score)
  }
  const bm: Scored[] = []
  for (const r of bm25.search(text, { filter: scope ? (r) => refs.get(r.id)?.path === scope.path : undefined })) {
    const ref = refs.get(r.id)
    if (ref) bm.push({ ...ref, score: r.score, terms: r.terms })
  }
  return { mode: qv ? 'hybrid' : 'bm25', sem, bm, terms: text.split(/\W+/).filter(Boolean) }
}

const indexing = () => (progress.done || !progress.total ? null : { indexed: progress.indexed, total: progress.total })

export async function searchSessions(text: string, limit = 30): Promise<SearchResult> {
  const { mode, sem, bm, terms } = await gather(text, null, 1)
  // best chunk per session for each method (the lists are best-first)
  const best = (xs: Scored[]) => { const m = new Map<string, { rank: number; h: Scored }>(); xs.forEach((h) => { if (!m.has(h.path)) m.set(h.path, { rank: m.size, h }) }); return m }
  const s = best(sem)
  const b = best(bm)
  const results: SessionHit[] = []
  for (const { key, score } of rrf([[...s.keys()], [...b.keys()]]).slice(0, limit)) {
    const e = entries.get(key)
    if (!e) continue
    const ss = s.get(key)
    const bb = b.get(key)
    const pick = !ss || (bb && bb.rank <= ss.rank) ? bb! : ss
    results.push({ sessionId: e.id, score, snippet: trimSnippet(e.texts[pick.h.i], [...(bb?.h.terms ?? []), ...terms]) })
  }
  return { mode, indexing: indexing(), results }
}

// The best matching chunks of one session, in full; null when the session is not in the index.
export async function searchInSession(text: string, sessionId: string, limit: number): Promise<{ mode: 'hybrid' | 'bm25'; indexing: SearchResult['indexing']; chunks: { text: string }[] } | null> {
  await load()
  const scope = [...entries.values()].find((e) => e.id === sessionId)
  if (!scope) return null
  const { mode, sem, bm } = await gather(text, scope, limit)
  const chunks = rrf([sem.map((h) => String(h.i)), bm.map((h) => String(h.i))]).slice(0, limit).map(({ key }) => ({ text: scope.texts[Number(key)] }))
  return { mode, indexing: indexing(), chunks }
}

export function sessionMeta(id: string): SessionMeta | undefined {
  const s = list.find((x) => x.id === id)
  return s && { id: s.id, title: s.title, project: s.project, updated: s.updated, path: s.path }
}
