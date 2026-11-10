// Quarry inside Hive, against a fake `quarry serve` (test/support/fakeQuarry.mjs, invented data only)
import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { checkCapabilities, formatConnections, formatError, formatRows, installRecord, lineSplitter, pickExe, QuarryError, restartDelay, uiRequest, writeQuestion, RUN_WRITE } from '../../src/main/quarryCore'
import { configureQuarry, quarryCall, quarryStatus, QuarryServe, stopQuarry } from '../../src/main/quarry'

const FAKE = resolve('test/support/fakeQuarry.mjs')
const viaNode = (): [string, ...string[]] => [process.execPath, FAKE, 'serve']
const serves: QuarryServe[] = []
afterAll(() => { for (const s of serves) s.stop(100); stopQuarry() })

test('capabilities: protocol 1 with every method Hive calls, else why not', () => {
  const caps = execFileSync(process.execPath, [FAKE, '--capabilities'], { encoding: 'utf8' })
  const c = checkCapabilities(caps)
  assert.equal(c.ok, true)
  assert.equal(c.ok && c.caps.version, '9.9.0')
  assert.match((checkCapabilities(JSON.stringify({ protocol: 2, version: '3.0.0', methods: [] })) as { reason: string }).reason, /protocol 2/)
  assert.match((checkCapabilities(JSON.stringify({ protocol: 1, version: '1.0.0', methods: ['rpc.hello'] })) as { reason: string }).reason, /lacks .*agent\.query/)
  assert.equal(checkCapabilities('not json').ok, false)
})

test('which exe: the setting, "off", what Quarry recorded, a default location; none = the feature is off', () => {
  const has = (p: string) => p === 'D:/apps/quarry.exe' || p === 'C:/Local/Quarry/quarry.exe'
  assert.equal(pickExe('E:/mine/quarry.exe', [], [], has), 'E:/mine/quarry.exe')
  assert.equal(pickExe('off', ['D:/apps/quarry.exe'], [], has), null)
  assert.equal(pickExe('', ['X:/gone/quarry.exe', 'D:/apps/quarry.exe'], ['C:/Local/Quarry/quarry.exe'], has), 'D:/apps/quarry.exe')
  assert.equal(pickExe('', [], ['C:/Local/Quarry/quarry.exe'], has), 'C:/Local/Quarry/quarry.exe')
  assert.equal(pickExe('', [], ['C:/nowhere.exe'], has), null)
  assert.deepEqual(installRecord(JSON.stringify({ exe: 'D:/apps/quarry.exe', version: '1.1.0', protocol: 1 })), { exe: 'D:/apps/quarry.exe', version: '1.1.0', protocol: 1 })
  assert.equal(installRecord('{'), null)
})

test('lines split across chunks come out whole, once', () => {
  const got: string[] = []
  const feed = lineSplitter((l) => got.push(l))
  feed('{"a":1}\n{"b"')
  feed(':2}\r\n\n{"c":3')
  assert.deepEqual(got, ['{"a":1}', '{"b":2}'])
  feed('}\n')
  assert.equal(got.at(-1), '{"c":3}')
})

test('the UI files: quarry://app/ paths to ui.index and ui.asset, never one that climbs out', () => {
  assert.deepEqual(uiRequest('quarry://app/'), { method: 'ui.index' })
  assert.deepEqual(uiRequest('quarry://app/index.html?theme=graphite'), { method: 'ui.index' })
  assert.deepEqual(uiRequest('quarry://app/assets/index-1.js'), { method: 'ui.asset', path: 'assets/index-1.js' })
  assert.deepEqual(uiRequest('quarry://app/../secret.txt'), { method: 'ui.asset', path: 'secret.txt' }) // the URL folds it inside the UI root
  assert.deepEqual(uiRequest('quarry://app/assets/%2e%2e/x'), { method: 'ui.asset', path: 'x' }) // so is an escaped one
  assert.equal(uiRequest('quarry://app/assets/%2F..%2Fx'), null) // an escaped slash would climb after decoding: refused
  assert.equal(uiRequest('quarry://other/x.js'), null)
  assert.equal(uiRequest('https://app/x.js'), null)
})

test('calls run concurrently and come back by id; errors carry Quarry\'s ApiError', async () => {
  const s = new QuarryServe(viaNode)
  serves.push(s)
  const [slow, hello] = await Promise.all([s.call('test.slow'), s.call('rpc.hello')])
  assert.equal(slow, 'slow')
  assert.deepEqual(hello, { name: 'Quarry', version: '9.9.0', protocol: 1 })
  await assert.rejects(s.call('no.such'), (e: QuarryError) => e.rpcCode === -32601)
  await assert.rejects(s.call('ui.asset', { path: 'nope.js' }), (e: QuarryError) => e.data?.code === 'not_found')
  assert.ok(s.stderrBytes > 0) // Quarry's log went to the counter, not to Hive's console
})

test('a serve that dies is started again (with a pause); a stopped one is not', async () => {
  const s = new QuarryServe(viaNode)
  serves.push(s)
  const pid1 = await s.call<number>('test.pid')
  await assert.rejects(s.call('test.crash'), /Quarry exited/)
  await new Promise((r) => setTimeout(r, 1500)) // restartDelay(1) = 1 s
  assert.equal(s.running, true)
  const pid2 = await s.call<number>('test.pid')
  assert.notEqual(pid1, pid2)
  assert.equal(s.starts, 2)
  s.stop(100)
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(s.running, false)
  assert.deepEqual([1, 2, 3, 6, 9].map(restartDelay), [1000, 2000, 4000, 30_000, 30_000])
})

test('configured: available only with a usable Quarry; calls go to its serve process', async () => {
  const how = { caps: async () => execFileSync(process.execPath, [FAKE, '--capabilities'], { encoding: 'utf8' }), command: viaNode, exists: () => true, recorded: async () => [] }
  const off = await configureQuarry('off', false, how)
  assert.deepEqual([off.available, off.reason], [false, 'turned off'])
  await assert.rejects(quarryCall('rpc.hello'), /not available/)
  assert.equal((await configureQuarry('', true, how)).available, false) // test mode: never
  const on = await configureQuarry('C:/apps/Quarry/quarry.exe', false, how)
  assert.deepEqual([on.available, on.version], [true, '9.9.0'])
  const rows = await quarryCall<{ rowCount: number }>('agent.query', { connection: 'c1', sql: 'select 1' })
  assert.equal(rows.rowCount, 2)
  assert.equal(quarryStatus().running, true)
  const old = await configureQuarry('C:/apps/Quarry/quarry.exe', false, { ...how, caps: async () => JSON.stringify({ protocol: 2, version: '5.0.0', methods: [] }) })
  assert.match(old.reason, /protocol 2/)
  assert.equal(old.available, false)
})

test('what the thread tools say: connections, rows (capped), errors, the write question', () => {
  const list = formatConnections([{ id: 'c1', name: 'Orchard demo', host: 'db.orchard.example', port: 5432, database: 'orchard', user: 'orchard_app', production: false }, { id: 'c2', name: 'Orchard live', host: 'h', database: 'd', production: true, readOnly: true }])
  assert.match(list, /Orchard demo \(id c1\): orchard_app@db\.orchard\.example:5432\/orchard/)
  assert.match(list, /PRODUCTION \(writes always refused\), read only/)
  const t = formatRows({ columns: [{ name: 'id' }, { name: 'variety' }], rows: [['1', 'Bosc'], ['2', null]], rowCount: 2, truncated: true, elapsedMs: 3, commandTag: 'SELECT 2' })
  assert.match(t, /^Database data returned through Quarry/)
  assert.match(t, /id\tvariety\n1\tBosc\n2\tNULL$/)
  assert.match(t, /more rows exist/)
  const capped = formatRows({ columns: [{ name: 'x' }], rows: Array.from({ length: 100 }, () => ['y'.repeat(50)]), rowCount: 100, truncated: false }, 600)
  assert.match(capped, /only the first \d+ of the 100 returned rows fit here/)
  assert.match(formatError(new QuarryError(-32000, 'x', { code: 'rejected', message: 'A write needs allowWrite: true', sqlstate: '25006' })), /Quarry refused or failed \(rejected\): A write needs allowWrite[\s\S]*SQLSTATE 25006/)
  const q = writeQuestion('Orchard demo', 'update pears set ripe = true')
  assert.equal(q[0].options[0].label, RUN_WRITE)
  assert.match(q[0].question, /Run this write on "Orchard demo"\?\n\nupdate pears/)
})

test('paths used here are inside the repo (no real Quarry needed)', () => {
  assert.ok(FAKE.startsWith(resolve('.')))
  assert.ok(join(FAKE).endsWith('fakeQuarry.mjs'))
})
