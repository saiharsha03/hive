// Lists every Claude Code session from ~/.claude/projects.
// Session files are large (1.9 GB total), so only the first and last 32 KB of each are read,
// and results are cached by file size + mtime.
import { app } from 'electron'
import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export type SessionInfo = { id: string; title: string; project: string; cwd: string; updated: number; started: number; path: string; entrypoint: string }
type CacheEntry = SessionInfo & { size: number; mtime?: number; v?: number } // v: parser version; bump to re-read every file

const ROOT = join(homedir(), '.claude', 'projects')
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
  return { id: basename(path, '.jsonl'), title: custom || ai || first.slice(0, 80), project: cwd ? basename(cwd) : '', cwd, updated: (!tailCut && last) || updated, started: started || updated, path, entrypoint }
}

export async function listSessions(): Promise<SessionInfo[]> {
  let cache: Record<string, CacheEntry> = {}
  try { cache = JSON.parse(await readFile(cacheFile(), 'utf8')) } catch { /* first run */ }

  const files: string[] = []
  for (const dir of await readdir(ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const f of await readdir(join(ROOT, dir.name))) if (f.endsWith('.jsonl')) files.push(join(ROOT, dir.name, f))
  }

  const next: Record<string, CacheEntry> = {}
  const out: SessionInfo[] = []
  for (let i = 0; i < files.length; i += 32) {
    await Promise.all(files.slice(i, i + 32).map(async (path) => {
      const s = await stat(path)
      const hit = cache[path]
      if (hit && hit.v === 3 && hit.size === s.size && hit.mtime === s.mtimeMs) {
        next[path] = hit
      } else {
        const info = parse(path, await readEnds(path, s.size), s.mtimeMs)
        if (info) next[path] = { ...info, size: s.size, mtime: s.mtimeMs, v: 3 }
      }
      const info = next[path]
      // sessions started inside temp/scratchpad folders are helpers, not real work
      // hidden: helper runs in temp/scratchpad folders, and sessions other programs start through the
      // Python Agent SDK (the security plugin's background reviews, bots); the terminal is "cli",
      // Hive's own sessions are "sdk-cli"
      if (info && !/\\AppData\\Local\\Temp\\/i.test(info.cwd) && info.entrypoint !== 'sdk-py') out.push(info)
    }))
  }

  await writeFile(cacheFile(), JSON.stringify(next))
  return out.sort((a, b) => b.updated - a.updated)
}
