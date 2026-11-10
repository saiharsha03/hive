// the relay end to end on a local port: pairing, sealed messages both ways (it forwards what it cannot read), the
// phone told when the computer is offline, wrong tokens refused, and Hive's sealing (mobileLink) round-tripping.
// Both sides sign in with the Authorization header, as Hive and the app do; ?token= stays for clients without headers.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, seal } from '../../src/main/mobileLink'

const PORT = 18000 + Math.floor(Math.random() * 1000)
const ADMIN = randomBytes(24).toString('hex')
const base = `http://127.0.0.1:${PORT}`
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Client = { ws: WebSocket; got: any[]; closed: Promise<number> }
type HeaderSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket
// how: 'header' = Authorization: Bearer (Node's WebSocket takes headers), 'query' = ?token=
function client(role: string, pair: string, token: string, how: 'header' | 'query' = 'header'): Promise<Client> {
  return new Promise((res, rej) => {
    const url = `ws://127.0.0.1:${PORT}/v1/ws?pair=${pair}&role=${role}`
    const ws = how === 'header'
      ? new (WebSocket as unknown as HeaderSocket)(url, { headers: { authorization: `Bearer ${token}` } })
      : new WebSocket(`${url}&token=${encodeURIComponent(token)}`)
    const got: any[] = []
    const closed = new Promise<number>((done) => { ws.onclose = (e) => done(e.code) })
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)))
    ws.onopen = () => res({ ws, got, closed })
    ws.onerror = () => rej(new Error(`${role} refused`))
  })
}

test('relay: pair, forward sealed blobs both ways, offline notice, wrong token refused', async () => {
  const state = join(mkdtempSync(join(tmpdir(), 'hive-relay-')), 'state.json')
  const relay = spawn(process.execPath, [join(__dirname, '../../relay/relay.mjs')], { env: { ...process.env, HIVE_RELAY_ADMIN_TOKEN: ADMIN, HIVE_RELAY_PORT: String(PORT), HIVE_RELAY_STATE: state }, stdio: 'pipe' })
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break } catch { /* starting */ } await wait(100) }
    const pair = randomBytes(16).toString('hex'), desk = 'desk-token', phone = 'phone-token', key = randomBytes(32)
    assert.equal((await fetch(`${base}/v1/pair`, { method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' })).status, 401)
    const r = await fetch(`${base}/v1/pair`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ pair, desk: sha(desk), phone: sha(phone) }) })
    assert.equal(r.status, 200)
    await assert.rejects(client('phone', pair, 'wrong'), /refused/)
    await assert.rejects(client('phone', pair, 'wrong', 'query'), /refused/)
    await assert.rejects(client('phone', pair, desk), /refused/) // the computer's token does not sign the phone in
    await assert.rejects(client('phone', 'f'.repeat(32), phone), /refused/) // nor does a pair the relay does not know
    const byQuery = await client('phone', pair, phone, 'query') // a client without headers
    byQuery.ws.close()
    await byQuery.closed

    // phone alone: told the computer is offline, and its message comes back as offline
    const p = await client('phone', pair, phone)
    await wait(150)
    assert.deepEqual(p.got.at(-1), { desk: 'offline' })
    const d = await client('desk', pair, desk)
    await wait(150)
    assert.deepEqual(p.got.at(-1), { desk: 'online' })

    // phone -> desk and back, sealed; the relay only passes the blob
    p.ws.send(JSON.stringify({ blob: seal(key, pair, 'p2d', { op: 'threads', seq: 1 }) }))
    await wait(150)
    const req = open(key, pair, 'p2d', d.got.at(-1).blob)
    assert.deepEqual(req, { op: 'threads', seq: 1 })
    assert.equal(open(key, pair, 'd2p', d.got.at(-1).blob), null) // a blob never opens in the other direction
    assert.equal(open(randomBytes(32), pair, 'p2d', d.got.at(-1).blob), null) // nor with another key
    d.ws.send(JSON.stringify({ blob: seal(key, pair, 'd2p', { re: 1, threads: [] }) }))
    await wait(150)
    assert.deepEqual(open(key, pair, 'd2p', p.got.at(-1).blob), { re: 1, threads: [] })
    // only the blob is passed on: nothing else a side puts in its frame reaches the other
    d.ws.send(JSON.stringify({ blob: 'x', desk: 'offline', push: false }))
    await wait(150)
    assert.deepEqual(p.got.at(-1), { blob: 'x' })

    // the phone's push token: only with the phone's own token for that pair
    const fcm = (token: string, body: object) => fetch(`${base}/v1/fcm`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await fcm('wrong', { pair, fcm: 'push-token' })).status, 401)
    assert.equal((await fcm(desk, { pair, fcm: 'push-token' })).status, 401)
    assert.equal((await fcm(phone, { pair: 'f'.repeat(32), fcm: 'push-token' })).status, 401)
    assert.equal((await fcm(phone, { pair, fcm: 'push-token' })).status, 200)
    const saved = JSON.parse(readFileSync(state, 'utf8'))
    assert.equal(saved[pair].fcm, 'push-token')
    assert.equal(saved[pair].phone, sha(phone)) // token hashes only, never the tokens
    assert.ok(!readFileSync(state, 'utf8').includes(phone))

    // a notification's button: one blob posted by the phone (no socket) reaches the computer, with the phone's token only
    const post = (token: string, body: object) => fetch(`${base}/v1/send`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await post('wrong', { pair, blob: 'z' })).status, 401)
    assert.equal((await post(desk, { pair, blob: 'z' })).status, 401)
    assert.equal((await post(phone, { pair })).status, 400)
    const sent = await post(phone, { pair, blob: seal(key, pair, 'n2d', { op: 'stop', id: 't1', seq: 2 }) })
    assert.deepEqual([sent.status, await sent.json()], [200, { ok: true, delivered: true }])
    await wait(150)
    assert.deepEqual(open(key, pair, 'n2d', d.got.at(-1).blob), { op: 'stop', id: 't1', seq: 2 })

    // a second connection for the same side replaces the first, which is closed with 4000
    const again = await client('phone', pair, phone)
    assert.equal(await p.closed, 4000)
    again.ws.close()
    await again.closed

    // an oversized frame drops that socket, never the relay
    p.ws.send('x'.repeat(3 * 1024 * 1024))
    await wait(300)
    assert.ok((await fetch(`${base}/healthz`)).ok)
    const p2 = await client('phone', pair, phone)
    await wait(150)

    // the computer goes away: the phone hears it
    d.ws.close()
    await wait(200)
    assert.deepEqual(p2.got.at(-1), { desk: 'offline' })
    // a message sent while the computer is away is answered with offline, not kept
    p2.ws.send(JSON.stringify({ blob: 'y' }))
    await wait(150)
    assert.deepEqual(p2.got.at(-1), { desk: 'offline' })
    assert.equal(p2.got.filter((f) => f.desk === 'offline').length, 2)
    assert.deepEqual(await (await post(phone, { pair, blob: 'z' })).json(), { ok: true, delivered: false }) // and a posted one says so

    // unpairing (Hive, with the admin token) closes both sides with 4401 and the tokens stop working
    const d2 = await client('desk', pair, desk)
    assert.equal((await fetch(`${base}/v1/pair/${pair}`, { method: 'DELETE', headers: { authorization: 'Bearer nope' } })).status, 401)
    assert.equal(d2.ws.readyState, WebSocket.OPEN)
    assert.equal((await fetch(`${base}/v1/pair/${pair}`, { method: 'DELETE', headers: { authorization: `Bearer ${ADMIN}` } })).status, 200)
    assert.deepEqual([await p2.closed, await d2.closed], [4401, 4401])
    await assert.rejects(client('phone', pair, phone), /refused/)
    await assert.rejects(client('desk', pair, desk), /refused/)
    assert.equal((await fcm(phone, { pair, fcm: 'push-token' })).status, 401)
    assert.equal(JSON.parse(readFileSync(state, 'utf8'))[pair], undefined)
  } finally {
    relay.kill()
  }
}, 20_000)
