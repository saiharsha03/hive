// Lists every Claude Code session from ~/.claude/projects.
// Session files are large (1.9 GB total), so only the first and last 32 KB of each are read, and results are cached by
// file size + mtime. The list is kept in memory: a call re-reads only the project folders whose time changed (a session
// was added or removed there) and the transcripts a live thread reported a turn end for (sessionTouched); every
// FULL_MS, or with full, every file is checked again (sessions written by the terminal). The cache file is written only
// when something changed, at most every SAVE_MS.
import { app } from 'electron'
import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isWatcherTranscript } from '../shared/readOnlyCore'
import { projectsRoot } from './testMode'
import { REVIEW_HEAD } from '../shared/dependabotCore'

export type SessionInfo = { id: string; title: string; project: string; cwd: string; updated: number; started: number; path: string; entrypoint: string; watcherRun?: boolean; dependabot?: boolean } // watcherRun: a watcher run's thread (its header is the first message); dependabot: a Dependabot review thread
type CacheEntry = SessionInfo & { size: number; mtime?: number; v?: number } // v: parser version; bump to re-read every file

// HIVE_PROJECTS_DIR: another projects folder (tests, the e2e harness); test mode never lists the real one (testMode.ts)
const root = () => projectsRoot()
const CHUNK = 32 * 1024
const cacheFile = () => join(app.getPath('userData'), 'sessions-cache.json')

// The head must reach the first real user message: many sessions open with long queue-operation /
// attachment lines, so the head grows (32 KB, 128 KB, 512 KB, 2 MB) until a user turn with a cwd and
// entrypoint appears or the file ends.
const HEAD_STEPS = [CHUNK, 128 * 1024, 512 * 1024, 2 * 1024 * 1024]
const headComplete = (t: string) => t.includes('"type":"user"') && t.includes('"cwd":') && t.includes('"entrypoint":')

async function readEnds(path: string, size: number): Promise<string> {
  const fh = await open(path, 'r')
  try {
    let head = ''
    for (const step of HEAD_STEPS) {
      const buf = Buffer.alloc(Math.min(step, size))
      await fh.read(buf, 0, buf.length, 0)
      head = buf.toString('utf8')
      if (buf.length >= size || headComplete(head)) break
    }
    if (head.length >= size - CHUNK) return head // the head already covers (almost) the whole file
    const tail = Buffer.alloc(CHUNK)
    await fh.read(tail, 0, CHUNK, size - CHUNK)
    return head + '\n' + tail.toString('utf8')
  } finally {
    await fh.close()
  }
}

function firstUserText(entry: any): string | null {
  if (entry.type !== 'user' || entry.isMeta) return null
  const c = entry.message?.content
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find((p: any) => p.type === 'text')?.text : null
  if (!text || text.startsWith('<') || text.startsWith('[Request interrupted')) return null
  return text.replace(/\s+/g, ' ').trim()
}

export function parse(path: string, text: string, updated: number): SessionInfo | null {
  let custom = '', ai = '', first = '', cwd = '', started = 0, entrypoint = '', last = 0
  // the file's final line cut off (a huge entry past the tail chunk): its time is unknown, so the file's time is used
  const lines = text.split('\n')
  const tail = [...lines].reverse().find((l) => l.trim() !== '') ?? ''
  let tailCut = false
  try { JSON.parse(tail) } catch { tailCut = true }
  for (const line of lines) {
    if (!line.startsWith('{')) continue // cut-off line at a chunk edge
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'custom-title' && e.customTitle) custom = e.customTitle
    else if (e.type === 'ai-title' && e.aiTitle) ai = e.aiTitle
    if (!cwd && e.cwd) cwd = e.cwd
    if (!entrypoint && e.entrypoint) entrypoint = e.entrypoint
    if (!started && e.timestamp) started = Date.parse(e.timestamp) || 0
    if (!first) first = firstUserText(e) ?? ''
    // the newest message (a title change, hook or summary line is not one), so the list orders by last activity
    if ((e.type === 'user' || e.type === 'assistant') && !e.isMeta && e.timestamp) last = Math.max(last, Date.parse(e.timestamp) || 0)
  }
  if (!first && !custom && !ai) return null // empty session
  return { id: basename(path, '.jsonl'), title: custom || ai || first.slice(0, 80), project: cwd ? basename(cwd) : '', cwd, updated: (!tailCut && last) || updated, started: started || updated, path, entrypoint, ...(isWatcherTranscript(text) === true ? { watcherRun: true } : {}), ...(first.startsWith(REVIEW_HEAD) ? { dependabot: true } : {}) }
}

// In memory: every transcript seen (null = an empty session, not listed), each project folder's time when last read,
// and the transcripts a live thread wrote to since (a turn ended)
const known = new Map<string, CacheEntry | { size: number; mtime: number; empty: true }>()
const folderTimes = new Map<string, number>()
const touched = new Set<string>()
let loaded = false
let lastFull = 0
let dirty = false
let lastSave = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null
const FULL_MS = 5 * 60_000
const SAVE_MS = 30_000
let scanning: Promise<SessionInfo[]> | null = null

// a live thread's turn ended: its transcript is read again on the next listing
export const sessionTouched = (path: string) => { touched.add(path) }
// a transcript's size and time as the list last saw them (search uses these instead of its own stat)
export function sessionStamp(path: string): { size: number; mtime: number } | null {
  const k = known.get(path)
  return k && k.mtime !== undefined ? { size: k.size, mtime: k.mtime } : null
}

function scheduleSave(): void {
  if (!dirty || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const all: Record<string, CacheEntry> = {}
    for (const [p, k] of known) if (!('empty' in k)) all[p] = k
    dirty = false
    lastSave = Date.now()
    writeFile(cacheFile(), JSON.stringify(all)).catch(() => { dirty = true })
  }, Math.max(0, SAVE_MS - (Date.now() - lastSave)))
  saveTimer.unref?.()
}

// one transcript: kept when its size and time are unchanged, read again otherwise
async function check(path: string): Promise<void> {
  let s
  try { s = await stat(path) } catch { if (known.delete(path)) dirty = true; return }
  const hit = known.get(path)
  if (hit && ('empty' in hit || (hit as CacheEntry).v === 5) && hit.size === s.size && hit.mtime === s.mtimeMs) return
  const info = parse(path, await readEnds(path, s.size), s.mtimeMs)
  known.set(path, info ? { ...info, size: s.size, mtime: s.mtimeMs, v: 5 } : { size: s.size, mtime: s.mtimeMs, empty: true })
  dirty = true
}

async function scan(full: boolean): Promise<SessionInfo[]> {
  if (!loaded) {
    loaded = true
    try { for (const [p, e] of Object.entries(JSON.parse(await readFile(cacheFile(), 'utf8')) as Record<string, CacheEntry>)) known.set(p, e) } catch { /* first run */ }
    full = true
  }
  if (Date.now() - lastFull > FULL_MS) full = true
  const todo = new Set<string>()
  const folders = new Set<string>()
  // no projects folder yet (a fresh install, a test data folder): no sessions, not an error the list waits on forever
  const dirs = await readdir(root(), { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e })
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const folder = join(root(), dir.name)
    folders.add(folder)
    let mtime: number
    try { mtime = (await stat(folder)).mtimeMs } catch { continue }
    if (!full && folderTimes.get(folder) === mtime) continue
    folderTimes.set(folder, mtime)
    // a session added, removed or renamed here (or a full check): every file in it, and what is gone drops out
    const names = new Set<string>()
    try { for (const f of await readdir(folder)) if (f.endsWith('.jsonl')) { names.add(join(folder, f)); todo.add(join(folder, f)) } } catch { continue }
    for (const p of [...known.keys()]) if (dirname(p) === folder && !names.has(p)) { known.delete(p); dirty = true }
  }
  for (const p of [...known.keys()]) if (!folders.has(dirname(p))) { known.delete(p); dirty = true } // the folder went
  for (const f of [...folderTimes.keys()]) if (!folders.has(f)) folderTimes.delete(f)
  for (const p of touched) todo.add(p)
  touched.clear()
  const list = [...todo]
  for (let i = 0; i < list.length; i += 32) await Promise.all(list.slice(i, i + 32).map(check))
  if (full) lastFull = Date.now()
  scheduleSave()

  const out: SessionInfo[] = []
  for (const k of known.values()) {
    if ('empty' in k) continue
    // hidden: helper runs in temp/scratchpad folders, and sessions other programs start through the
    // Python Agent SDK (the security plugin's background reviews, bots); the terminal is "cli",
    // Hive's own sessions are "sdk-cli"
    if (/\\AppData\\Local\\Temp\\/i.test(k.cwd) || k.entrypoint === 'sdk-py') continue
    const { size: _s, mtime: _m, v: _v, ...info } = k
    out.push(info)
  }
  return out.sort((a, b) => b.updated - a.updated)
}

// full: check every file again (the periodic refresh); otherwise only what changed (see the top of the file).
// Calls that come while a listing runs share it
export function listSessions(opts: { full?: boolean } = {}): Promise<SessionInfo[]> {
  if (scanning && !opts.full) return scanning
  const run = (scanning ?? Promise.resolve([] as SessionInfo[])).catch(() => []).then(() => scan(!!opts.full))
  const p = run.finally(() => { if (scanning === p) scanning = null })
  scanning = p
  return p
}
