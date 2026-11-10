// A stand-in for `quarry serve` (JSON-RPC 2.0, one object per line on stdin and stdout), with invented data only.
// Extra methods for tests: test.crash (exits at once), test.slow (answers after 300 ms), test.pid.
// --capabilities prints the same shape a real Quarry does.
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const METHODS = ['rpc.hello', 'ui.asset', 'ui.index', 'agent.listConnections', 'agent.describeSchema', 'agent.query', 'agent.explain']
if (args.includes('--capabilities')) {
  console.log(JSON.stringify({ name: 'Quarry', version: '9.9.0', protocol: Number(process.env.FAKE_QUARRY_PROTOCOL ?? 1), transports: ['stdio-jsonrpc'], methods: METHODS, agent: { maxRows: 1000, defaultRows: 200, maxTimeoutMs: 60000, defaultTimeoutMs: 15000 } }))
  process.exit(0)
}
if (!args.includes('serve')) process.exit(2)

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const ok = (id, result) => out({ jsonrpc: '2.0', id, result })
const fail = (id, code, message, data) => out({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } })
const api = (id, code, message) => fail(id, -32000, message, { code, message, sqlstate: null, detail: null, hint: null, position: null })
const b64 = (s) => Buffer.from(s).toString('base64')
const CONN = { id: 'c1', name: 'Orchard demo', host: 'db.orchard.example', port: 5432, database: 'orchard', user: 'orchard_app', production: false, readOnly: false, hasPassword: true }
const PROD = { ...CONN, id: 'c2', name: 'Orchard live', production: true }
process.stderr.write('fake quarry: started (this line must never show in Hive logs)\n')

createInterface({ input: process.stdin }).on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) }
  const { id, method, params = {} } = m
  if (id === undefined) return
  switch (method) {
    case 'rpc.hello': return ok(id, { name: 'Quarry', version: '9.9.0', protocol: 1 })
    case 'ui.index': return ok(id, { mime: 'text/html; charset=utf-8', base64: b64('<!doctype html><script src="/assets/app.js"></script>') })
    case 'ui.asset': return params.path === 'assets/app.js' ? ok(id, { mime: 'text/javascript; charset=utf-8', base64: b64('console.log(1)') }) : api(id, 'not_found', `no asset ${params.path}`)
    case 'agent.listConnections': return ok(id, [CONN, PROD])
    case 'agent.describeSchema': return ok(id, { schemas: ['public'], detail: false, tables: [{ schema: 'public', name: 'pears', kind: 'table', estimatedRows: 3, columnCount: 2 }] })
    case 'agent.query': {
      const write = /^\s*(insert|update|delete)/i.test(params.sql ?? '')
      if (write && params.connection === 'c2') return api(id, 'rejected', 'A write on a PRODUCTION connection is always refused')
      if (write && !params.allowWrite) return api(id, 'rejected', 'A write needs allowWrite: true')
      if (write) return ok(id, { columns: [], rows: [], rowCount: 1, truncated: false, elapsedMs: 2, commandTag: 'UPDATE 1' })
      return ok(id, { columns: [{ name: 'id', dataType: 'integer' }, { name: 'variety', dataType: 'text' }], rows: [['1', 'Bosc'], ['2', null]], rowCount: 2, truncated: false, elapsedMs: 3, commandTag: 'SELECT 2', echo: params })
    }
    case 'agent.explain': return ok(id, { plan: {}, text: 'Seq Scan on pears', planningMs: 0.1, executionMs: null, analyze: false })
    case 'list_connections': return ok(id, [CONN])
    case 'test.slow': return setTimeout(() => ok(id, 'slow'), 300)
    case 'test.pid': return ok(id, process.pid)
    case 'test.crash': return process.exit(3)
    default: return fail(id, -32601, `unknown method ${method}`)
  }
}).on('close', () => process.exit(0))
