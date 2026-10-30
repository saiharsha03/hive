// Lists every Claude Code session from ~/.claude/projects.
// Session files are large (1.9 GB total), so only the first and last 32 KB of each are read,
// and results are cached by file size + mtime.
import { app } from 'electron'
import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export type SessionInfo = { id: string; title: string; project: string; cwd: string; updated: number; started: number; path: string }
type CacheEntry = SessionInfo & { size: number }

const ROOT = join(homedir(), '.claude', 'projects')
const CHUNK = 32 * 1024
const cacheFile = () => join(app.getPath('userData'), 'sessions-cache.json')

async function readEnds(path: string, size: number): Promise<string> {
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(CHUNK, size))
    await fh.read(head, 0, head.length, 0)
    if (size <= CHUNK * 2) {
      const all = Buffer.alloc(size)
      await fh.read(all, 0, size, 0)
      return all.toString('utf8')
    }
    const tail = Buffer.alloc(CHUNK)
    await fh.read(tail, 0, CHUNK, size - CHUNK)
    return head.toString('utf8') + '\n' + tail.toString('utf8')
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

function parse(path: string, text: string, updated: number): SessionInfo | null {
  let custom = '', ai = '', first = '', cwd = '', started = 0
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue // cut-off line at a chunk edge
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'custom-title' && e.customTitle) custom = e.customTitle
    else if (e.type === 'ai-title' && e.aiTitle) ai = e.aiTitle
    if (!cwd && e.cwd) cwd = e.cwd
    if (!started && e.timestamp) started = Date.parse(e.timestamp) || 0
    if (!first) first = firstUserText(e) ?? ''
  }
  if (!first && !custom && !ai) return null // empty session
  return { id: basename(path, '.jsonl'), title: custom || ai || first.slice(0, 80), project: cwd ? basename(cwd) : '', cwd, updated, started: started || updated, path }
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
      if (hit && hit.started && hit.size === s.size && hit.updated === s.mtimeMs) {
        next[path] = hit
      } else {
        const info = parse(path, await readEnds(path, s.size), s.mtimeMs)
        if (info) next[path] = { ...info, size: s.size }
      }
      const info = next[path]
      // sessions started inside temp/scratchpad folders are helpers, not real work
      if (info && !/\\AppData\\Local\\Temp\\/i.test(info.cwd)) out.push(info)
    }))
  }

  await writeFile(cacheFile(), JSON.stringify(next))
  return out.sort((a, b) => b.updated - a.updated)
}
