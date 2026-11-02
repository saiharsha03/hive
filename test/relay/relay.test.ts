// the relay end to end on a local port: pairing, sealed messages both ways (it forwards what it cannot read), the
// phone told when the computer is offline, wrong tokens refused, and Hive's sealing (mobileLink) round-tripping
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, seal } from '../../src/main/mobileLink'

const PORT = 18000 + Math.floor(Math.random() * 1000)
const ADMIN = randomBytes(24).toString('hex')
const base = `http://127.0.0.1:${PORT}`
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function client(role: string, pair: string, token: string): Promise<{ ws: WebSocket; got: any[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?pair=${pair}&role=${role}&token=${encodeURIComponent(token)}`)
    const got: any[] = []
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)))
    ws.onopen = () => res({ ws, got })
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

    // the computer goes away: the phone hears it
    d.ws.close()
    await wait(200)
    assert.deepEqual(p.got.at(-1), { desk: 'offline' })
    p.ws.close()
  } finally {
    relay.kill()
  }
}, 20_000)
