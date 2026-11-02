// Hive relay: the meeting point between Hive on your computer and the Hive app on your phone, so neither has to be
// reachable from the internet. Both sides dial out to it. It only checks tokens (it stores their SHA-256, never the
// tokens), forwards sealed blobs it cannot read (AES-256-GCM with a key only the computer and phone have), tells the
// phone whether the computer is online, and pushes through Firebase when the app is closed.
//
// Run it on a server behind a reverse proxy (Caddy, nginx), or on your own computer behind cloudflared. See README.md.
//
//   HIVE_RELAY_ADMIN_TOKEN   required: what Hive sends to register a paired phone (any long random string)
//   HIVE_RELAY_PORT          default 8787
//   HIVE_RELAY_HOST          default 127.0.0.1 (put a TLS proxy or tunnel in front; never expose plain HTTP)
//   HIVE_RELAY_STATE         default ./relay-state.json (pairs: token hashes and the phone's push token)
//   HIVE_RELAY_FCM_ACCOUNT   optional: path to a Firebase service-account JSON; without it there are no pushes
import { createHash, createSign, timingSafeEqual } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const ADMIN = process.env.HIVE_RELAY_ADMIN_TOKEN ?? ''
const PORT = Number(process.env.HIVE_RELAY_PORT ?? 8787)
const HOST = process.env.HIVE_RELAY_HOST ?? '127.0.0.1'
const STATE = process.env.HIVE_RELAY_STATE ?? './relay-state.json'
const FCM_ACCOUNT = process.env.HIVE_RELAY_FCM_ACCOUNT ?? ''
const MAX_MESSAGE = 512 * 1024 // a thread's recent messages, sealed
const PUSH_INLINE = 3000 // a sealed blob this small rides in the push itself; bigger ones push a wake-up only
if (ADMIN.length < 24) { console.error('HIVE_RELAY_ADMIN_TOKEN must be set (24+ characters)'); process.exit(1) }

// ---- state: pair id -> { desk, phone: sha256 hex of their tokens, fcm: the phone's push token } ----
let pairs = {}
try { pairs = JSON.parse(readFileSync(STATE, 'utf8')) } catch { /* first run */ }
const save = () => { writeFileSync(`${STATE}.tmp`, JSON.stringify(pairs)); renameSync(`${STATE}.tmp`, STATE) }
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
const authed = (pair, role, token) => { const p = pairs[pair]; return !!p && !!token && same(p[role] ?? '', sha(token)) }

// ---- Firebase Cloud Messaging (HTTP v1), with a service-account token minted here (no Google libraries) ----
let fcm = null
if (FCM_ACCOUNT) {
  try { fcm = { sa: JSON.parse(readFileSync(FCM_ACCOUNT, 'utf8')), token: '', until: 0 } } catch (e) { console.error('FCM account unreadable, no pushes:', e.message) }
}
const b64url = (b) => Buffer.from(b).toString('base64url')
async function fcmToken() {
  if (fcm.token && Date.now() < fcm.until) return fcm.token
  const now = Math.floor(Date.now() / 1000)
  const claims = { iss: fcm.sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: fcm.sa.token_uri, iat: now, exp: now + 3600 }
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(fcm.sa.private_key)
  const r = await fetch(fcm.sa.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }) })
  const j = await r.json()
  if (!j.access_token) throw new Error(`FCM auth failed: ${r.status}`)
  fcm.token = j.access_token
  fcm.until = Date.now() + (j.expires_in - 120) * 1000
  return fcm.token
}
async function push(pair, blob) {
  const to = pairs[pair]?.fcm
  if (!fcm || !to) return
  // data only: the app decrypts it and shows the notification itself, so Google never sees the text
  const data = blob.length <= PUSH_INLINE ? { blob } : { wake: '1' }
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcm.sa.project_id}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${await fcmToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: to, data, android: { priority: 'high' } } }),
    })
    if (r.status === 404 || r.status === 400) { pairs[pair].fcm = ''; save() } // the app was removed or its token changed
  } catch (e) { console.error('push failed:', e.message) }
}

// ---- HTTP: health, pairing (Hive, with the admin token), the phone's push token ----
const body = (req) => new Promise((res, rej) => {
  let s = ''
  req.on('data', (c) => { s += c; if (s.length > 64 * 1024) { rej(new Error('too big')); req.destroy() } })
  req.on('end', () => { try { res(s ? JSON.parse(s) : {}) } catch (e) { rej(e) } })
})
const reply = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://relay')
    if (req.method === 'GET' && url.pathname === '/healthz') return reply(res, 200, { ok: true, push: !!fcm })
    if (req.method === 'POST' && url.pathname === '/v1/pair') {
      if (!same(bearer(req), ADMIN)) return reply(res, 401, { error: 'unauthorized' })
      const b = await body(req)
      if (!/^[a-f0-9]{16,64}$/.test(b.pair ?? '') || !/^[a-f0-9]{64}$/.test(b.desk ?? '') || !/^[a-f0-9]{64}$/.test(b.phone ?? '')) return reply(res, 400, { error: 'bad pair' })
      pairs[b.pair] = { desk: b.desk, phone: b.phone, fcm: '' }
      save()
      return reply(res, 200, { ok: true })
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/v1/pair/')) {
      if (!same(bearer(req), ADMIN)) return reply(res, 401, { error: 'unauthorized' })
      const pair = url.pathname.slice('/v1/pair/'.length)
      for (const ws of sockets.get(pair)?.values() ?? []) ws.close(4401, 'unpaired')
      delete pairs[pair]
      save()
      return reply(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/v1/fcm') {
      const b = await body(req)
      if (!authed(b.pair, 'phone', bearer(req))) return reply(res, 401, { error: 'unauthorized' })
      pairs[b.pair].fcm = String(b.fcm ?? '').slice(0, 4096)
      save()
      return reply(res, 200, { ok: true })
    }
    reply(res, 404, { error: 'not found' })
  } catch (e) {
    reply(res, 400, { error: String(e.message ?? e) })
  }
})

// ---- WebSocket: /v1/ws?pair=&role=desk|phone (token in the Authorization header, or ?token= for clients without headers) ----
const sockets = new Map() // pair -> Map(role -> ws)
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://relay')
  const pair = url.searchParams.get('pair') ?? ''
  const role = url.searchParams.get('role') ?? ''
  const token = bearer(req) || url.searchParams.get('token') || ''
  if (url.pathname !== '/v1/ws' || !['desk', 'phone'].includes(role) || !authed(pair, role, token)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, pair, role))
})

const peerOf = (role) => (role === 'desk' ? 'phone' : 'desk')
const sendJson = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)) }
function attach(ws, pair, role) {
  if (!sockets.has(pair)) sockets.set(pair, new Map())
  const room = sockets.get(pair)
  room.get(role)?.close(4000, 'replaced') // one connection per side
  room.set(role, ws)
  if (role === 'desk') sendJson(room.get('phone'), { desk: 'online' })
  if (role === 'phone') sendJson(ws, { desk: room.get('desk')?.readyState === 1 ? 'online' : 'offline' })
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })
  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(String(raw)) } catch { return }
    if (typeof m.blob !== 'string') return
    const peer = room.get(peerOf(role))
    if (peer?.readyState === 1) peer.send(JSON.stringify({ blob: m.blob }))
    else if (role === 'desk' && m.push) void push(pair, m.blob)
    else if (role === 'phone') sendJson(ws, { desk: 'offline' })
  })
  ws.on('close', () => {
    if (room.get(role) !== ws) return
    room.delete(role)
    if (role === 'desk') sendJson(room.get('phone'), { desk: 'offline' })
  })
}
// dead connections (a laptop that slept, a phone that lost signal) are dropped within a minute
setInterval(() => {
  for (const room of sockets.values()) for (const ws of room.values()) { if (!ws.isAlive) ws.terminate(); else { ws.isAlive = false; ws.ping() } }
}, 30_000).unref()

server.listen(PORT, HOST, () => console.log(`Hive relay on http://${HOST}:${PORT} (pushes ${fcm ? 'on' : 'off'})`))
