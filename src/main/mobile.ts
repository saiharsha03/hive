// The phone app's side of Hive: pairing (a QR code with the relay address, the pair id, the phone's token and the
// sealing key), one outgoing connection to the relay, the phone's requests (list threads, read one, send, start a new
// one, stop) and notifications (Claude's notify_phone, a thread waiting for you, a background thread finished).
// Settings: HIVE_MOBILE_RELAY (https://...) and HIVE_MOBILE_ADMIN_TOKEN (the relay's admin token). The pairing lives
// in ~/.claude/hive-mobile.json; the key never leaves this computer except inside the QR code shown to you.
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { open, seal } from './mobileLink'
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
  start: (folder: string, text: string) => Promise<string>
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
type Pairing = { relay: string; pair: string; deskToken: string; key: string; seqOut: number; seqIn: number; future?: number[]; floor?: number }

const file = () => join(dataDir(), 'hive-mobile.json')
let relay = ''
let admin = ''
let deps: Deps | null = null
let pairing: Pairing | null = null
let ws: WebSocket | null = null
let connected = false
let error = ''
let retry: ReturnType<typeof setTimeout> | undefined

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
    const sock = new WebSocket(`${wsOf(p.relay)}/v1/ws?pair=${p.pair}&role=desk&token=${encodeURIComponent(p.deskToken)}`)
    ws = sock
    sock.onopen = () => { connected = true; error = ''; deps?.changed() }
    sock.onmessage = (e) => { void onMessage(String(e.data)) }
    sock.onclose = (e) => {
      if (ws !== sock) return
      connected = false
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
export function checkPhoneSeq(st: SeqState, seq: number, now: number): { run: boolean; future?: boolean; next: Required<SeqState> } {
  // an entry that expires raises the floor, so a refused request can never run after it leaves the list
  const all = st.refused ?? []
  const refused = all.filter((s) => s > now - FRESH_MS)
  const next = { seqIn: st.seqIn, refused, floor: Math.max(st.floor ?? 0, ...all.filter((s) => s <= now - FRESH_MS)) }
  if (seq <= st.seqIn || seq <= next.floor || refused.includes(seq)) return { run: false, next }
  if (seq > now + FRESH_MS) {
    if (refused.length >= FUTURE_KEEP) return { run: false, future: true, next: { ...next, floor: seq } }
    return { run: false, future: true, next: { ...next, refused: [...refused, seq] } }
  }
  if (refused.length >= FUTURE_KEEP || Math.abs(now - seq) > FRESH_MS) return { run: false, next }
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

function sendToPhone(msg: Record<string, unknown>, push = false): void {
  if (!pairing || !ws || ws.readyState !== WebSocket.OPEN) return
  pairing.seqOut += 1
  const blob = seal(Buffer.from(pairing.key, 'base64'), pairing.pair, 'd2p', { ...msg, seq: pairing.seqOut, at: Date.now() })
  store()
  ws.send(JSON.stringify({ blob, push }))
}

async function onMessage(raw: string): Promise<void> {
  if (!pairing || !deps) return
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
      case 'send': return reply({ ok: await deps.send(id, String(m.text ?? '')) })
      case 'new': return reply({ ok: await deps.start(String(m.folder ?? ''), String(m.text ?? '')) })
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
  sendToPhone(fitNotification(title, body, thread ?? ''), true)
  return 'Sent to the phone.'
}
