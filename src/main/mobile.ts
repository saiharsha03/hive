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

export type PhoneThread = { id: string; title: string; folder: string; state: 'working' | 'waiting' | 'idle'; note: string; updated: number }
export type PhoneItem = { k: 'you' | 'claude' | 'tool' | 'note'; t: string }
export type MobileStatus = { configured: boolean; paired: boolean; connected: boolean; error: string }
type Deps = {
  threads: () => Promise<PhoneThread[]>
  read: (id: string) => Promise<{ title: string; items: PhoneItem[]; working: boolean } | null>
  send: (id: string, text: string) => Promise<string>
  start: (folder: string, text: string) => Promise<string>
  stop: (id: string) => Promise<void>
  folders: () => string[]
  changed: () => void
}
type Pairing = { relay: string; pair: string; deskToken: string; key: string; seqOut: number; seqIn: number }

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
  if (!m || typeof m.seq !== 'number' || m.seq <= pairing.seqIn) return // not from the paired phone, or a replay
  pairing.seqIn = m.seq
  store()
  const id = typeof m.id === 'string' ? m.id : ''
  const reply = (body: Record<string, unknown>) => sendToPhone({ re: m.rid, ...body })
  try {
    switch (m.op) {
      case 'threads': return reply({ threads: await deps.threads(), folders: deps.folders() })
      case 'thread': return reply({ thread: await deps.read(id) })
      case 'send': return reply({ ok: await deps.send(id, String(m.text ?? '')) })
      case 'new': return reply({ ok: await deps.start(String(m.folder ?? ''), String(m.text ?? '')) })
      case 'stop': await deps.stop(id); return reply({ ok: 'stopped' })
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
  sendToPhone({ op: 'notify', title: title.slice(0, 120), body: body.slice(0, 600), thread: thread ?? '' }, true)
  return 'Sent to the phone.'
}
