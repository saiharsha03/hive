// Per-session numbers for the status bar, read from the session's transcript: model, context size, cache warm/cold,
// when the session started, compactions, and the thread's token totals (/usage).
// The status bar asks every few seconds and a transcript can be hundreds of MB, so reads are incremental: each path
// keeps its size, mtime, how far it was read and the running numbers, and only bytes appended since are read. The first
// read of a big file takes the head (start time) and the tail (everything the bar shows) at once; the part between is
// scanned in the background for the compaction count and the token totals.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'

export type SessionStats = {
  model: string | null
  contextTokens: number | null
  lastReplyAt: number | null // ms; cache is warm until lastReplyAt + cacheTtlMs
  cacheTtlMs: number
  startedAt: number | null
  compactions: number // times the conversation was compacted (auto or /compact)
}
// what the thread's own requests used, summed over the main conversation (subagents keep their own transcripts)
// complete: false while the middle of a big transcript is still being scanned
export type SessionTotals = { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number; complete: boolean }

// ttlSeen: a turn showed which cache it writes to (the cache length is known)
type Acc = SessionStats & { totals: Omit<SessionTotals, 'complete'>; lastId: string | null; ttlSeen: boolean }
const fresh = (): Acc => ({
  // 5 minutes until a turn shows the session writes to the 1-hour cache: never claim warm when unsure
  model: null, contextTokens: null, lastReplyAt: null, cacheTtlMs: 300_000, startedAt: null, compactions: 0,
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }, lastId: null, ttlSeen: false,
})

// one transcript line into the running numbers. middle: a line from before the tail already read (a big file's
// background scan), which only adds to the counts
export function foldLine(acc: Acc, line: string, middle = false): void {
  if (!line.startsWith('{')) return
  // most lines carry neither usage nor a compaction: only those (and the lines before the start time is known) are parsed
  if (!line.includes('"usage"') && !line.includes('compact_boundary') && (acc.startedAt || middle)) return
  let e: any
  try { e = JSON.parse(line) } catch { return }
  const at = Date.parse(e.timestamp ?? '')
  if (!middle && !acc.startedAt && at) acc.startedAt = at
  if (e.type === 'system' && e.subtype === 'compact_boundary') acc.compactions++
  const m = e.message
  if (e.type !== 'assistant' || !m?.usage || e.isSidechain) return
  const u = m.usage
  // one request is written as several lines (one per content block) with the same id and usage: counted once
  if (!m.id || m.id !== acc.lastId) {
    acc.lastId = m.id ?? null
    acc.totals.input += u.input_tokens ?? 0
    acc.totals.output += u.output_tokens ?? 0
    acc.totals.cacheWrite += u.cache_creation_input_tokens ?? 0
    acc.totals.cacheRead += u.cache_read_input_tokens ?? 0
    acc.totals.requests++
  }
  // the cache length is only known from a turn that wrote to it; a pure cache hit keeps the last known one
  const c = u.cache_creation
  if ((c?.ephemeral_1h_input_tokens ?? 0) > 0) { acc.cacheTtlMs = 3_600_000; acc.ttlSeen = true }
  else if ((c?.ephemeral_5m_input_tokens ?? 0) > 0) { acc.cacheTtlMs = 300_000; acc.ttlSeen = true }
  if (middle) return
  // what the last request sent = fresh input + cache written + cache read
  acc.contextTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  acc.model = m.model ?? acc.model
  acc.lastReplyAt = at || acc.lastReplyAt
}

// the whole text at once (tests, small inputs)
export function statsOfText(text: string): SessionStats {
  const acc = fresh()
  for (const line of text.split('\n')) foldLine(acc, line.replace(/\r$/, ''))
  return pick(acc)
}

const pick = (a: Acc): SessionStats => ({ model: a.model, contextTokens: a.contextTokens, lastReplyAt: a.lastReplyAt, cacheTtlMs: a.cacheTtlMs, startedAt: a.startedAt, compactions: a.compactions })

type Entry = { size: number; mtime: number; offset: number; acc: Acc; middle: Promise<void> | null; complete: boolean }
const cache = new Map<string, Entry>()
const MAX_PATHS = 200
let BIG = 8 * 1024 * 1024 // a first read above this takes head + tail and scans the rest in the background
let TAIL = 2 * 1024 * 1024
const HEAD = 256 * 1024
const CHUNK = 4 * 1024 * 1024
export const setStatsSizes = (big: number, tail: number) => { BIG = big; TAIL = tail } // tests

type Handle = Awaited<ReturnType<typeof open>>
// whole lines of [from, to): each one to f; returns where the last whole line ended (the rest is read next time)
async function eachLine(fh: Handle, from: number, to: number, f: (line: string) => void): Promise<number> {
  let pos = from
  let carry = Buffer.alloc(0)
  let end = from
  while (pos < to) {
    const n = Math.min(CHUNK, to - pos)
    const buf = Buffer.alloc(n)
    const { bytesRead } = await fh.read(buf, 0, n, pos)
    if (!bytesRead) break
    const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
    const last = data.lastIndexOf(0x0a)
    if (last < 0) { carry = data } else {
      for (const line of data.subarray(0, last).toString('utf8').split('\n')) f(line.replace(/\r$/, ''))
      carry = data.subarray(last + 1)
      end = pos + bytesRead - carry.length
    }
    pos += bytesRead
  }
  return end
}

async function update(path: string): Promise<Entry | null> {
  let st
  try { st = await stat(path) } catch { cache.delete(path); return null }
  let e = cache.get(path)
  // shorter than what was read, or the same size with a new time: rewritten, read again from the start
  if (e && (st.size < e.offset || (st.size === e.size && st.mtimeMs !== e.mtime))) { cache.delete(path); e = undefined }
  if (e && st.size === e.size && st.mtimeMs === e.mtime) return e
  const fh = await open(path, 'r')
  try {
    if (e) {
      // only what was appended since the last read
      const acc = e.acc
      e.offset = await eachLine(fh, e.offset, st.size, (l) => foldLine(acc, l))
      e.size = st.size; e.mtime = st.mtimeMs
      return e
    }
    const acc = fresh()
    const entry: Entry = { size: st.size, mtime: st.mtimeMs, offset: 0, acc, middle: null, complete: true }
    if (st.size <= BIG) {
      entry.offset = await eachLine(fh, 0, st.size, (l) => foldLine(acc, l))
    } else {
      // the start time from the head; the bar's numbers from the tail, read from its first whole line
      await eachLine(fh, 0, Math.min(HEAD, st.size), (l) => { if (!acc.startedAt) foldLine(acc, l) })
      const probe = Buffer.alloc(Math.min(64 * 1024, TAIL))
      const tailFrom = st.size - TAIL
      const { bytesRead } = await fh.read(probe, 0, probe.length, tailFrom)
      const nl = probe.subarray(0, bytesRead).indexOf(0x0a)
      const tailStart = nl < 0 ? st.size : tailFrom + nl + 1
      const startedAt = acc.startedAt
      entry.offset = await eachLine(fh, tailStart, st.size, (l) => foldLine(acc, l))
      acc.startedAt = startedAt ?? acc.startedAt
      // the middle, in the background: compactions and token totals only
      entry.complete = false
      entry.middle = scanMiddle(path, tailStart, entry)
    }
    cache.set(path, entry)
    while (cache.size > MAX_PATHS) cache.delete(cache.keys().next().value!)
    return entry
  } finally { await fh.close() }
}

async function scanMiddle(path: string, to: number, entry: Entry): Promise<void> {
  const part = fresh()
  part.startedAt = 1 // never parse a line only for the start time here
  try {
    const fh = await open(path, 'r')
    try { await eachLine(fh, 0, to, (l) => foldLine(part, l, true)) } finally { await fh.close() }
  } catch { return }
  if (cache.get(path) !== entry) return
  entry.acc.compactions += part.compactions
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'requests'] as const) entry.acc.totals[k] += part.totals[k]
  // the tail never showed the cache length: the last one the middle did is still the one in force
  if (!entry.acc.ttlSeen && part.ttlSeen) { entry.acc.cacheTtlMs = part.cacheTtlMs; entry.acc.ttlSeen = true }
  entry.complete = true
}

// one read at a time per path: a poll that comes while a read runs gets that read's answer
const inflight = new Map<string, Promise<Entry | null>>()
function read(path: string): Promise<Entry | null> {
  const cur = inflight.get(path)
  if (cur) return cur
  const p = update(path).catch(() => null).finally(() => inflight.delete(path))
  inflight.set(path, p)
  return p
}

export async function sessionStats(path: string): Promise<SessionStats> {
  const e = await read(path)
  return e ? pick(e.acc) : pick(fresh())
}

export async function sessionTotals(path: string): Promise<SessionTotals> {
  const e = await read(path)
  return e ? { ...e.acc.totals, complete: e.complete } : { ...fresh().totals, complete: true }
}

// the background scan of a big file, for tests and callers that want the full totals
export async function settled(path: string): Promise<void> { await cache.get(path)?.middle }

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
