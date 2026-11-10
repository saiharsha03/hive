// The phone app's side of Hive: pairing (a QR code with the relay address, the pair id, the phone's token and the
// sealing key), one outgoing connection to the relay, the phone's requests (list threads, read one, send, start a new
// one, stop) and notifications (Claude's notify_phone, a thread waiting for you, a background thread finished).
// Settings: HIVE_MOBILE_RELAY (https://...) and HIVE_MOBILE_ADMIN_TOKEN (the relay's admin token). The pairing lives
// in ~/.claude/hive-mobile.json; the key never leaves this computer except inside the QR code shown to you.
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { notifyKey, open, seal } from './mobileLink'
import { writeFileSafe } from './safeWrite'
import { blocked, dataDir, TEST_MODE } from './testMode'

export type { PhoneThread } from '../shared/threadsCore'
import type { PhoneThread } from '../shared/threadsCore'
import type { UsageRow } from '../shared/usageCore'
import type { AskQuestion } from '../shared/askCore'
import type { PhoneTeam, PhoneWakeup } from '../shared/phoneCore'
export type PhoneItem = { k: 'you' | 'claude' | 'tool' | 'note'; t: string }
export type MobileStatus = { configured: boolean; paired: boolean; connected: boolean; error: string }
type Deps = {
  threads: () => Promise<PhoneThread[]>
  // asks: Claude's open multiple-choice questions in that thread (an older app ignores them)
  read: (id: string) => Promise<{ title: string; items: PhoneItem[]; working: boolean; asks?: { id: string; questions: AskQuestion[] }[] } | null>
  answer: (id: string, ask: string, answers: unknown) => boolean
  send: (id: string, text: string) => Promise<string>
  // { id }: the new thread's id, so the app can open it (a plain string is the older 'started')
  start: (folder: string, text: string) => Promise<string | { id: string }>
  stop: (id: string) => Promise<void>
  folders: () => string[]
  usage: () => Promise<{ plan: string | null; rows: UsageRow[] }>
  changed: () => void
  // 2.0: teams, a thread's background work, wake-ups (a 1.x phone app never asks for them)
  teams: () => PhoneTeam[]
  teamPause: (id: string) => Promise<string>
  teamResume: (id: string) => Promise<string>
  stopTask: (thread: string, task: string) => Promise<boolean>
  wakeups: () => PhoneWakeup[]
  cancelWakeup: (kind: string, id: string) => boolean
}
// future: refused requests dated ahead of this computer's clock (see checkPhoneSeq)
// nk: the app said (hello, v 2) that it opens notifications with the notification key
type Pairing = { relay: string; pair: string; deskToken: string; key: string; seqOut: number; seqIn: number; future?: number[]; floor?: number; nk?: boolean }

const file = () => join(dataDir(), 'hive-mobile.json')
let relay = ''
let admin = ''
let deps: Deps | null = null
let pairing: Pairing | null = null
let ws: WebSocket | null = null
let connected = false
let error = ''
let retry: ReturnType<typeof setTimeout> | undefined
// the desk token goes in the Authorization header, never in the address (a proxy logs addresses). Only a runtime whose
// WebSocket cannot send headers falls back to ?token= (see connect)
let headerAuth = true
type HeaderSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket

const load = (): Pairing | null => { try { return JSON.parse(readFileSync(file(), 'utf8')) } catch { return null } }
const store = () => writeFileSafe(file(), JSON.stringify(pairing ?? {}))
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const httpOf = (u: string) => u.replace(/\/+$/, '')
const wsOf = (u: string) => httpOf(u).replace(/^http/, 'ws')

export const mobileStatus = (): MobileStatus => ({ configured: !!relay && !!admin, paired: !!pairing?.pair, connected, error })

export function initMobile(env: Record<string, string>, d: Deps): void {
  relay = (env.HIVE_MOBILE_RELAY ?? '').trim()
  admin = (env.HIVE_MOBILE_ADMIN_TOKEN ?? '').trim()
  deps = d
  pairing = load()
  if (pairing && !pairing.pair) pairing = null
  if (pairing && 'seen' in pairing) delete (pairing as { seen?: unknown }).seen // left by an earlier version

  if (TEST_MODE) return
  connect()
}

// ---- pairing ----
export async function pairPhone(): Promise<{ qr: string }> {
  if (TEST_MODE) throw new Error(blocked('pairing a phone'))
  if (!relay || !admin) throw new Error('Set the relay address and its admin token first (Settings > General > Phone app).')
  const pair = randomBytes(16).toString('hex')
  const deskToken = randomBytes(32).toString('base64url')
  const phoneToken = randomBytes(32).toString('base64url')
  const key = randomBytes(32).toString('base64')
  const r = await fetch(`${httpOf(relay)}/v1/pair`, {
    method: 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pair, desk: sha(deskToken), phone: sha(phoneToken) }), signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`The relay refused the pairing (${r.status}). Check the relay address and admin token.`)
  if (pairing) await unpairRemote(pairing).catch(() => {}) // one phone at a time
  pairing = { relay: httpOf(relay), pair, deskToken, key, seqOut: 0, seqIn: 0 }
  ran.clear()
  store()
  connect()
  // the phone's copy: everything it needs, shown only on this screen as a QR code
  return { qr: JSON.stringify({ v: 1, relay: httpOf(relay), pair, token: phoneToken, key }) }
}

const unpairRemote = (p: Pairing) => fetch(`${p.relay}/v1/pair/${p.pair}`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` }, signal: AbortSignal.timeout(15_000) })

export async function unpairPhone(): Promise<void> {
  const p = pairing
  pairing = null
  store()
  ws?.close()
  if (p) await unpairRemote(p).catch(() => {})
  deps?.changed()
}

// ---- the link ----
function connect(): void {
  clearTimeout(retry)
  ws?.close()
  ws = null
  connected = false
  if (!pairing) { deps?.changed(); return }
  const p = pairing
  try {
    const url = `${wsOf(p.relay)}/v1/ws?pair=${p.pair}&role=desk`
    const byHeader = headerAuth
    const sock = byHeader
      ? new (WebSocket as unknown as HeaderSocket)(url, { headers: { authorization: `Bearer ${p.deskToken}` } })
      : new WebSocket(`${url}&token=${encodeURIComponent(p.deskToken)}`)
    ws = sock
    let opened = false
    sock.onopen = () => { opened = true; connected = true; error = ''; deps?.changed() }
    sock.onmessage = (e) => { void onMessage(String(e.data)) }
    sock.onclose = (e) => {
      if (ws !== sock) return
      connected = false
      // refused before it opened although the relay answers: this runtime's WebSocket may have dropped the header
      if (byHeader && !opened) void fetch(`${p.relay}/healthz`, { signal: AbortSignal.timeout(10_000) }).then((r) => { if (r.ok) headerAuth = false }).catch(() => {})
      error = e.code === 4401 ? 'The relay says this phone is no longer paired' : ''
      deps?.changed()
      if (e.code !== 4401 && pairing) retry = setTimeout(connect, 15_000) // the relay restarted, the network dropped: try again
    }
    sock.onerror = () => { error = 'Cannot reach the relay' }
  } catch (e) {
    error = String((e as Error).message ?? e)
    retry = setTimeout(connect, 30_000)
  }
}

const FRESH_MS = 120_000

// Replay protection for phone requests: a request runs only if its seq (the phone's own counter, never going back) is
// above the last one that ran, and within 2 minutes of this computer's clock (so the relay cannot hold one back and
// deliver it later). Anything else is dropped silently: no reply, no write, nothing that grows, whatever the relay sends.
// One exception is remembered: a request dated in the future (the phone clock ahead) is refused now and kept in a list,
// so a relay holding it until it looks fresh cannot run it later. Entries leave only once they are in the past (then the
// freshness check refuses them anyway), never to make room: with FUTURE_KEEP of them waiting, every request is refused
// until some expire (fail closed; it takes a phone clock that stays far ahead). A future-dated one that finds the list
// full raises floor instead: nothing at or below it ever runs (it stops mattering once the clock passes it).
const FUTURE_KEEP = 50
export type SeqState = { seqIn: number; refused?: number[]; floor?: number }
export function checkPhoneSeq(st: SeqState, seq: number, now: number): { run: boolean; future?: boolean; stale?: boolean; next: Required<SeqState> } {
  // an entry that expires raises the floor, so a refused request can never run after it leaves the list
  const all = st.refused ?? []
  const refused = all.filter((s) => s > now - FRESH_MS)
  const next = { seqIn: st.seqIn, refused, floor: Math.max(st.floor ?? 0, ...all.filter((s) => s <= now - FRESH_MS)) }
  if (seq <= st.seqIn || seq <= next.floor || refused.includes(seq)) return { run: false, next }
  if (seq > now + FRESH_MS) {
    if (refused.length >= FUTURE_KEEP) return { run: false, future: true, next: { ...next, floor: seq } }
    return { run: false, future: true, next: { ...next, refused: [...refused, seq] } }
  }
  if (refused.length >= FUTURE_KEEP) return { run: false, next }
  // new to Hive but older than the window: the phone clock is behind, or the relay held it back
  if (now - seq > FRESH_MS) return { run: false, stale: true, next }
  return { run: true, next: { ...next, seqIn: seq } }
}
// a notification small enough that, sealed (nonce + tag + base64), it rides in one push: FCM data is at most 4 KB and the
// relay inlines blobs up to 3600 characters. Measured on the JSON (escaping can grow text a lot), with room for seq/at.
const NOTIFY_JSON_MAX = 2500
export function fitNotification(title: string, body: string, thread: string): { op: 'notify'; title: string; body: string; thread: string } {
  const msg = { op: 'notify' as const, title: byteCap(title, 240), body: byteCap(body, 1500), thread: thread.slice(0, 120) }
  const size = () => Buffer.byteLength(JSON.stringify({ ...msg, seq: 1e15, at: 1e15 }))
  while (size() > NOTIFY_JSON_MAX && msg.body) msg.body = byteCap(msg.body, Math.floor(Buffer.byteLength(msg.body) * 0.8))
  while (size() > NOTIFY_JSON_MAX && msg.title) msg.title = byteCap(msg.title, Math.floor(Buffer.byteLength(msg.title) * 0.8))
  return msg
}
// at most n UTF-8 bytes, cut on a character boundary
export function byteCap(s: string, n: number): string {
  if (Buffer.byteLength(s) <= n) return s
  let out = ''
  for (const ch of s) { if (Buffer.byteLength(out + ch + '…') > n) break; out += ch }
  return `${out}…`
}

// note: a notification. An app that said it has the notification key gets it sealed with that key (it opens it from a
// push while locked); an older app gets it under the pairing key as before. at: this computer's clock, so the app can
// tell a delayed notification and a phone clock that is off.
function sendToPhone(msg: Record<string, unknown>, push = false, note = false): void {
  if (!pairing || !ws || ws.readyState !== WebSocket.OPEN) return
  pairing.seqOut += 1
  const key = Buffer.from(pairing.key, 'base64')
  const own = note && !!pairing.nk
  const blob = seal(own ? notifyKey(key) : key, pairing.pair, own ? 'd2n' : 'd2p', { ...msg, seq: pairing.seqOut, at: Date.now() })
  store()
  ws.send(JSON.stringify({ blob, push }))
}

// A send or a new thread the app tries again after its 20 s wait ran out carries the same mid: it runs once, and the
// second try gets the first one's answer. Kept in memory for ten minutes (the app only retries while it is open).
const RAN_KEEP_MS = 10 * 60_000
const ran = new Map<string, { at: number; result: Promise<unknown> }>()
export function oncePerMid<T>(mid: unknown, run: () => Promise<T>, now = Date.now()): Promise<T> {
  if (typeof mid !== 'string' || !mid || mid.length > 64) return run() // an older app sends none
  for (const [k, v] of ran) if (now - v.at > RAN_KEEP_MS) ran.delete(k)
  const had = ran.get(mid)
  if (had) return had.result as Promise<T>
  const result = run()
  ran.set(mid, { at: now, result })
  result.catch(() => ran.delete(mid)) // one that failed did not run: it may be tried again
  if (ran.size > 50) ran.delete(ran.keys().next().value as string)
  return result
}

const MAX_FRAME = 4 * 1024 * 1024 // the relay passes at most 2 MB; anything longer is not parsed
let staleSaid = 0

async function onMessage(raw: string): Promise<void> {
  if (!pairing || !deps || raw.length > MAX_FRAME) return
  let frame: { blob?: string }
  try { frame = JSON.parse(raw) } catch { return }
  if (!frame.blob) return
  const m = open(Buffer.from(pairing.key, 'base64'), pairing.pair, 'p2d', frame.blob)
  if (!m || typeof m.seq !== 'number') return // not from the paired phone
  // the phone's seq is its clock in ms, kept from going back on the phone; the phone gives up after 20 s, so a request
  // older than 2 minutes was held back (see checkPhoneSeq)
  const c = checkPhoneSeq({ seqIn: pairing.seqIn ?? 0, refused: pairing.future, floor: pairing.floor }, m.seq, Date.now())
  const changed = JSON.stringify([c.next.refused, c.next.floor]) !== JSON.stringify([pairing.future ?? [], pairing.floor ?? 0])
  pairing.future = c.next.refused
  pairing.floor = c.next.floor
  if (!c.run) { // a replay, held back, or the phone clock off: dropped silently (a future-dated one is remembered)
    if (changed) store()
    // said once per such request (a replay of it is remembered, so silent)
    if (c.future) sendToPhone({ re: m.rid, error: 'The phone clock is ahead of the computer by more than 2 minutes. Fix the clock and try again.' })
    // a stale one is answered too, so the app does not wait 20 s for nothing; at most once in 30 s, and nothing is kept
    // (the relay can replay old requests as often as it likes)
    else if (c.stale && Date.now() - staleSaid > 30_000) {
      staleSaid = Date.now()
      sendToPhone({ re: m.rid, error: 'This request reached the computer more than 2 minutes after the phone sent it, so it was not run. If it keeps happening, the phone clock is behind: fix it and try again.' })
    }
    return
  }
  pairing.seqIn = c.next.seqIn
  if (!store()) return void sendToPhone({ re: m.rid, error: 'Hive could not save its replay record, so the request was not run' })
  const id = typeof m.id === 'string' ? m.id : ''
  const reply = (body: Record<string, unknown>) => sendToPhone({ re: m.rid, ...body })
  try {
    switch (m.op) {
      case 'threads': return reply({ threads: await deps.threads(), folders: deps.folders() })
      case 'thread': return reply({ thread: await deps.read(id) })
      case 'usage': return reply({ usage: await deps.usage() })
      case 'answer': return deps.answer(id, String(m.ask ?? ''), m.answers) ? reply({ ok: 'answered' }) : reply({ error: 'That question is no longer open' })
      // the app's first request after it connects; v 2 and up opens notifications with the notification key
      case 'hello':
        if (typeof m.v === 'number' && m.v >= 2 && !pairing.nk) { pairing.nk = true; store() }
        return reply({ ok: 'hello', v: 2 })
      case 'send': { const d = deps; return reply({ ok: await oncePerMid(m.mid, () => d.send(id, String(m.text ?? ''))) }) }
      case 'new': {
        const d = deps
        const r = await oncePerMid(m.mid, () => d.start(String(m.folder ?? ''), String(m.text ?? '')))
        return reply(typeof r === 'string' ? { ok: r } : { ok: 'started', thread: r.id })
      }
      // "Unpair this phone" in the app: answered first, then the pairing is dropped here and on the relay
      case 'unpair': reply({ ok: 'unpaired' }); return void (await unpairPhone())
      case 'stop': await deps.stop(id); return reply({ ok: 'stopped' })
      case 'teams': return reply({ teams: deps.teams() })
      case 'teamPause': return reply({ ok: await deps.teamPause(id) })
      case 'teamResume': return reply({ ok: await deps.teamResume(id) })
      case 'stopTask': return (await deps.stopTask(id, String(m.task ?? ''))) ? reply({ ok: 'stopped' }) : reply({ error: 'That task is not running' })
      case 'wakeups': return reply({ wakeups: deps.wakeups() })
      case 'cancelWakeup': return deps.cancelWakeup(String(m.kind ?? ''), id) ? reply({ ok: 'cancelled' }) : reply({ error: 'That wake-up is not scheduled' })
      default: return reply({ error: `unknown request ${String(m.op)}` })
    }
  } catch (e) {
    reply({ error: String((e as Error).message ?? e) })
  }
}

// ---- notifications: shown on the phone even when the app is closed (the relay pushes the sealed blob) ----
export function notifyPhone(title: string, body: string, thread?: string): string {
  if (TEST_MODE) return blocked('phone notifications')
  if (!pairing) return 'No phone is paired with Hive (Settings > General > Phone app).'
  if (!connected) return 'Hive is not connected to the relay right now, so the phone was not notified.'
  sendToPhone(fitNotification(title, body, thread ?? ''), true, true)
  return 'Sent to the phone.'
}
