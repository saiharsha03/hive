// Against a real `quarry serve`, when HIVE_QUARRY_EXE names one (skipped otherwise). It opens no database connection:
// the protocol (hello, an unknown method, the UI's files) and an agent call on a connection that does not exist.
import { afterAll, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { checkCapabilities, QuarryError } from '../../src/main/quarryCore'
import { configureQuarry, quarryCall, QuarryServe, stopQuarry } from '../../src/main/quarry'

const exe = process.env.HIVE_QUARRY_EXE ?? ''
const serve = exe && existsSync(exe) ? new QuarryServe(() => [exe, 'serve']) : null
afterAll(() => { serve?.stop(); stopQuarry() })

describe.skipIf(!serve)('a real quarry serve', () => {
  test('capabilities: protocol 1 with the methods Hive uses', () => {
    const c = checkCapabilities(execFileSync(exe, ['--capabilities'], { encoding: 'utf8', windowsHide: true }))
    assert.equal(c.ok, true, c.ok ? '' : c.reason)
  })
  test('hello, an unknown method, the UI files, a connection that does not exist', async () => {
    const hello = await serve!.call<{ name: string; protocol: number }>('rpc.hello')
    assert.deepEqual([hello.name, hello.protocol], ['Quarry', 1])
    await assert.rejects(serve!.call('no.such.method'), (e: QuarryError) => e.rpcCode === -32601)
    const index = await serve!.call<{ mime: string; base64: string }>('ui.index')
    assert.match(index.mime, /text\/html/)
    const html = Buffer.from(index.base64, 'base64').toString('utf8')
    const asset = html.match(/(?:src|href)="\/?([^"]+\.(?:js|css))"/)?.[1]
    assert.ok(asset, 'the index names an asset')
    const a = await serve!.call<{ mime: string }>('ui.asset', { path: asset })
    assert.match(a.mime, /javascript|css/)
    await assert.rejects(serve!.call('ui.asset', { path: 'no/such/file.js' }), (e: QuarryError) => e.data?.code === 'not_found')
    await assert.rejects(serve!.call('agent.query', { connection: 'no-such-connection-hive-test', sql: 'select 1' }), (e: QuarryError) => e.data?.code === 'not_found')
  })
  test('configured with that exe: available, and calls reach its serve process', async () => {
    const st = await configureQuarry(exe, false)
    assert.equal(st.available, true, st.reason)
    assert.match(st.version ?? '', /^\d+\.\d+/)
    assert.equal((await quarryCall<{ protocol: number }>('rpc.hello')).protocol, 1)
  })
})
