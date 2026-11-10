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
import { limitedAnswer, noteActions, noteKind, phoneInbox, type NoteActions, type NoteKind, type PhoneAccount, type PhoneAsk, type PhoneFail, type PhonePeek, type PhoneRunning, type PhoneTeam, type PhoneWakeup, type QuietHours } from '../shared/phoneCore'
// seen: on your own message, whether Claude has taken it in (true) or not yet (false); absent when Hive cannot tell
export type PhoneItem = { k: 'you' | 'claude' | 'tool' | 'note'; t: string; seen?: boolean }
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
  // 2.0 app. All optional: the app is told which there are (hello's "can") and hides the rest; where Hive can do the
  // job with what is above (peek, running, stopAll) it does.
  // a thread right now, without reading its transcript (inbox, notification buttons)
  peek?: (id: string) => PhonePeek | null
  // every running background task in every thread
  running?: () => PhoneRunning[] | Promise<PhoneRunning[]>
  // interrupt every thread and stop every background task; pauseWakeups: also hold wake-ups and loops
  stopAll?: (pauseWakeups: boolean) => Promise<{ threads: number; tasks: number }>
  // fire a scheduled wake-up or auto-continue now
  runWakeNow?: (kind: string, id: string) => boolean | Promise<boolean>
  // the account profiles and the switch between them
  accounts?: () => PhoneAccount[] | Promise<PhoneAccount[]>
  switchAccount?: (id: string) => Promise<string>
  // Hive's own quiet hours: read them, or set and read them
  quietHours?: (set?: QuietHours) => QuietHours | Promise<QuietHours>
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
// more: its kind (the app rings through quiet hours only for a failure) and the buttons it may carry (noteActions);
// both are small and bounded, and the text gives way to them
export type PhoneNote = { op: 'notify'; title: string; body: string; thread: string; kind?: NoteKind } & NoteActions
export function fitNotification(title: string, body: string, thread: string, more: { kind?: NoteKind } & NoteActions = {}): PhoneNote {
  const msg: PhoneNote = { op: 'notify' as const, title: byteCap(title, 240), body: byteCap(body, 1500), thread: thread.slice(0, 120), ...more }
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

// ---- what the 2.0 app asks for, from the optional deps or from the ones every Hive has ----
// which optional requests this Hive answers; the app hides the screens and buttons for the others
const can = (d: Deps): string[] => ['inbox', 'running', 'stopAll', 'noteButtons', ...(d.runWakeNow ? ['runWake'] : []), ...(d.accounts && d.switchAccount ? ['accounts'] : []), ...(d.quietHours ? ['quiet'] : [])]

async function peekThread(d: Deps, id: string): Promise<PhonePeek | null> {
  if (d.peek) return d.peek(id)
  const t = await d.read(id) // without peek: the transcript is read for its asks (only for waiting threads and notifications)
  return t ? { working: t.working, asks: (t.asks ?? []) as PhoneAsk[] } : null
}

// every running background task; without the dep, the tasks of the threads that are working or waiting, kept 3 s
// (the inbox and the Running screen ask within moments of each other)
let runningKept: { at: number; rows: PhoneRunning[] } | null = null
async function runningNow(d: Deps, threads: PhoneThread[]): Promise<PhoneRunning[]> {
  if (d.running) return d.running()
  if (runningKept && Date.now() - runningKept.at < 3_000) return runningKept.rows
  const live = threads.filter((t) => t.state !== 'idle')
  const rows = (await Promise.all(live.map(async (t) => {
    const r = await d.read(t.id).catch(() => null)
    const tasks = ((r as { tasks?: { id: string; kind: string; title: string; now: string }[] } | null)?.tasks ?? [])
    return tasks.map((x): PhoneRunning => ({ thread: t.id, threadTitle: t.title, id: x.id, kind: x.kind, title: x.title, now: x.now, state: 'working' }))
  }))).flat()
  runningKept = { at: Date.now(), rows }
  return rows
}

// Stop everything: every thread that is working or waiting is interrupted and every background task stopped.
// pauseWakeups needs the dep (Hive's own "stop everything"); without it the wake-ups stay as they are, and the answer says so.
async function stopEverything(d: Deps, pauseWakeups: boolean): Promise<{ threads: number; tasks: number; wakeups: boolean }> {
  if (d.stopAll) return { ...(await d.stopAll(pauseWakeups)), wakeups: pauseWakeups }
  const threads = await d.threads()
  runningKept = null
  const tasks = (await runningNow(d, threads)).filter((t) => t.state === 'working' && t.id)
  runningKept = null
  let stopped = 0
  for (const t of tasks) if (await d.stopTask(t.thread, t.id).catch(() => false)) stopped += 1
  const busy = threads.filter((t) => t.state === 'working')
  await Promise.all(busy.map((t) => d.stop(t.id).catch(() => {})))
  return { threads: busy.length, tasks: stopped, wakeups: false }
}

// threads that failed (chat.ts says so in a notification) and were not written to since: the inbox lists them
const fails = new Map<string, PhoneFail>()
const FAIL_KEEP_MS = 24 * 3_600_000

// The press of a notification's button, sealed with the notification key (the app was locked): stop a thread, or pick
// a harmless choice of the thread's open question. Nothing else, whatever the message says, and no reply: when the
// answer is not taken the phone gets a notification saying why.
async function limitedRequest(d: Deps, m: Record<string, unknown>): Promise<void> {
  const id = typeof m.id === 'string' ? m.id : ''
  if (!id) return
  if (m.op === 'stop') return void (await d.stop(id).catch(() => {}))
  if (m.op !== 'answer') return
  const ask = String(m.ask ?? '')
  const took = limitedAnswer(await peekThread(d, id).catch(() => null), ask, String(m.label ?? ''))
  const refused = 'refused' in took ? took.refused : d.answer(id, ask, took.answers) ? '' : 'That question is no longer open'
  if (refused) sendToPhone(fitNotification('Not answered', `${refused}. Open Hive to answer.`, id), true, true)
}

async function onMessage(raw: string): Promise<void> {
  if (!pairing || !deps || raw.length > MAX_FRAME) return
  let frame: { blob?: string }
  try { frame = JSON.parse(raw) } catch { return }
  if (!frame.blob) return
  const key = Buffer.from(pairing.key, 'base64')
  // limited: sealed with the notification key, which the app can use without the fingerprint (a notification's button)
  const full = open(key, pairing.pair, 'p2d', frame.blob)
  const m = full ?? (pairing.nk ? open(notifyKey(key), pairing.pair, 'n2d', frame.blob) : null)
  const limited = !full
  if (!m || typeof m.seq !== 'number') return // not from the paired phone
  // the phone's seq is its clock in ms, kept from going back on the phone; the phone gives up after 20 s, so a request
  // older than 2 minutes was held back (see checkPhoneSeq)
  const c = checkPhoneSeq({ seqIn: pairing.seqIn ?? 0, refused: pairing.future, floor: pairing.floor }, m.seq, Date.now())
  const changed = JSON.stringify([c.next.refused, c.next.floor]) !== JSON.stringify([pairing.future ?? [], pairing.floor ?? 0])
  pairing.future = c.next.refused
  pairing.floor = c.next.floor
  if (!c.run) { // a replay, held back, or the phone clock off: dropped silently (a future-dated one is remembered)
    if (changed) store()
    if (limited) return // a button press gets no reply
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
  if (limited) return void (await limitedRequest(deps, m).catch(() => {}))
  const id = typeof m.id === 'string' ? m.id : ''
  const reply = (body: Record<string, unknown>) => sendToPhone({ re: m.rid, ...body })
  try {
    switch (m.op) {
      // ---- the 2.0 app ----
      case 'inbox': {
        const d = deps
        const threads = await d.threads()
        const waiting = threads.filter((t) => t.state === 'waiting')
        const asks = Object.fromEntries(await Promise.all(waiting.map(async (t) => [t.id, (await peekThread(d, t.id).catch(() => null))?.asks ?? []] as const)))
        const now = Date.now()
        for (const [k, f] of fails) if (now - f.at > FAIL_KEEP_MS) fails.delete(k)
        const wake = d.wakeups()
        const box = phoneInbox(threads, asks, [...fails.values()], wake, now)
        return reply({ ...box, counts: { needs: box.needs.length, threads: threads.length, running: (await runningNow(d, threads)).length, scheduled: wake.length } })
      }
      case 'running': return reply({ running: await runningNow(deps, await deps.threads()) })
      case 'stopAll': return reply({ ok: 'stopped', ...(await stopEverything(deps, m.wakeups === true)) })
      case 'dismiss': fails.delete(id); return reply({ ok: 'dismissed' })
      case 'runWake': {
        if (!deps.runWakeNow) return reply({ error: 'unknown request runWake' })
        return (await deps.runWakeNow(String(m.kind ?? ''), id)) ? reply({ ok: 'started' }) : reply({ error: 'That wake-up is not scheduled' })
      }
      case 'accounts': {
        if (!deps.accounts) return reply({ error: 'unknown request accounts' })
        return reply({ accounts: await deps.accounts() })
      }
      case 'switchAccount': {
        if (!deps.switchAccount) return reply({ error: 'unknown request switchAccount' })
        return reply({ ok: await deps.switchAccount(id) })
      }
      case 'quiet': {
        if (!deps.quietHours) return reply({ error: 'unknown request quiet' })
        const q = m.set as Partial<QuietHours> | undefined
        const ok = q && typeof q.on === 'boolean' && /^\d\d:\d\d$/.test(String(q.from)) && /^\d\d:\d\d$/.test(String(q.to))
        return reply({ quiet: await deps.quietHours(ok ? { on: q.on as boolean, from: String(q.from), to: String(q.to) } : undefined) })
      }
      case 'threads': return reply({ threads: await deps.threads(), folders: deps.folders() })
      case 'thread': return reply({ thread: await deps.read(id) })
      case 'usage': return reply({ usage: await deps.usage() })
      case 'answer': return deps.answer(id, String(m.ask ?? ''), m.answers) ? reply({ ok: 'answered' }) : reply({ error: 'That question is no longer open' })
      // the app's first request after it connects; v 2 and up opens notifications with the notification key
      case 'hello':
        if (typeof m.v === 'number' && m.v >= 2 && !pairing.nk) { pairing.nk = true; store() }
        return reply({ ok: 'hello', v: 3, can: can(deps) })
      case 'send': { const d = deps; fails.delete(id); return reply({ ok: await oncePerMid(m.mid, () => d.send(id, String(m.text ?? ''))) }) }
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
  const kind = noteKind(title)
  const id = thread ?? ''
  if (kind === 'fail' && id) fails.set(id, { thread: id, title: title.replace(/^Failed:\s*/, ''), note: body, at: Date.now() })
  else if (id) fails.delete(id) // it went on (a question, a finish): no longer a failure to look at
  const d = deps
  // the buttons (a question's choices, Stop) need the thread's state now; only an app with the notification key can
  // press them, and a notification is never held back for them
  if (!d || !id || !pairing.nk) sendToPhone(fitNotification(title, body, id, { kind }), true, true)
  else void peekThread(d, id).catch(() => null).then((p) => sendToPhone(fitNotification(title, body, id, { kind, ...noteActions(p) }), true, true))
  return 'Sent to the phone.'
}
