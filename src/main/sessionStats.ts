// Per-session numbers for the status bar, read from the session's transcript:
// model, context size, cache warm/cold and when the session started.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

export type SessionStats = {
  model: string | null
  contextTokens: number | null
  lastReplyAt: number | null // ms; cache is warm until lastReplyAt + cacheTtlMs
  cacheTtlMs: number
  startedAt: number | null
  compactions: number // times the conversation was compacted (auto or /compact)
}

export async function sessionStats(path: string): Promise<SessionStats> {
  // 5 minutes until a turn shows the session writes to the 1-hour cache: never claim warm when unsure
  const out: SessionStats = { model: null, contextTokens: null, lastReplyAt: null, cacheTtlMs: 300_000, startedAt: null, compactions: 0 }
  let text: string
  try { text = await readFile(path, 'utf8') } catch { return out }
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    const at = Date.parse(e.timestamp ?? '')
    if (!out.startedAt && at) out.startedAt = at
    if (e.type === 'system' && e.subtype === 'compact_boundary') out.compactions++
    const m = e.message
    if (e.type !== 'assistant' || !m?.usage || e.isSidechain) continue
    const u = m.usage
    // what the last request sent = fresh input + cache written + cache read
    out.contextTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    out.model = m.model ?? out.model
    out.lastReplyAt = at || out.lastReplyAt
    // the cache length is only known from a turn that wrote to it; a pure cache hit keeps the last known one
    const c = u.cache_creation
    if ((c?.ephemeral_1h_input_tokens ?? 0) > 0) out.cacheTtlMs = 3_600_000
    else if ((c?.ephemeral_5m_input_tokens ?? 0) > 0) out.cacheTtlMs = 300_000
  }
  return out
}

// the context the thread's last request sent (fresh + cache written + cache read), read from the transcript's end only,
// so it is cheap enough to ask before every watcher run; null when unknown
export function lastContextTokens(path: string, tailBytes = 512 * 1024): number | null {
  let text: string
  try {
    const fd = openSync(path, 'r')
    try {
      const size = fstatSync(fd).size
      const n = Math.min(size, tailBytes)
      const buf = Buffer.alloc(n)
      readSync(fd, buf, 0, n, size - n)
      text = buf.toString('utf8')
    } finally { closeSync(fd) }
  } catch { return null }
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue
    let e: any
    try { e = JSON.parse(lines[i]) } catch { continue }
    const u = e.message?.usage
    if (e.type !== 'assistant' || !u || e.isSidechain) continue
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  }
  return null
}
