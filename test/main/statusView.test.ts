// /status and /usage for one thread, and the / menu's command list
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { threadStatusView } from '../../src/main/statusView'
import { menuCommands } from '../../src/main/threadCore'

const dir = mkdtempSync(join(tmpdir(), 'hive-statusview-'))
const transcript = (cwd: string, id: string) => join(dir, `${cwd.replace(/\W/g, '-')}-${id}.jsonl`)
const status = async () => ({
  account: 'me@example.com', plan: 'max', five: null, seven: null, usageAt: 1000,
  usage: [{ key: 'five_hour', label: 'Current session (5 hours)', pct: 42, resetsAt: '2026-11-09T18:00:00Z' }],
  connectors: null, engine: { installed: true, version: '9.9.9' },
})
const mcp = async () => [{ name: 'orbit', status: 'connected', scope: 'sdk', tools: [{}, {}] }] as any

test('a live thread: its own process answers, with the transcript\'s token totals and the plan limits', async () => {
  const f = transcript('C:/r/app', 'sess-1')
  writeFileSync(f, [
    JSON.stringify({ type: 'user', timestamp: '2026-11-09T10:00:00Z', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-09T10:00:05Z', message: { id: 'm1', model: 'claude-x', content: [], usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 100 } } }),
  ].join('\n') + '\n')
  const q = {
    accountInfo: async () => ({ email: 'me@example.com', organization: 'Org', subscriptionType: 'max', tokenSource: 'oauth', apiProvider: 'firstParty' }),
    mcpServerStatus: mcp,
    getContextUsage: async () => ({ totalTokens: 1234, maxTokens: 200_000 }),
  } as any
  const v = await threadStatusView({
    liveQuery: () => q, transcript, status: status as any,
    facts: () => ({ sessionId: 'sess-1', cwd: 'C:/r/app', mode: 'bypassPermissions', model: 'claude-x', effort: 'high', memoryDir: 'C:/m' }),
  }, 'tab-1')
  assert.equal(v.live, true)
  assert.deepEqual(v.account, { email: 'me@example.com', organization: 'Org', plan: 'max', tokenSource: 'oauth', apiProvider: 'firstParty' })
  assert.deepEqual([v.model, v.effort, v.permissionMode, v.sessionId, v.cwd, v.memoryDir], ['claude-x', 'high', 'bypassPermissions', 'sess-1', 'C:/r/app', 'C:/m'])
  assert.deepEqual(v.context, { total: 1234, max: 200_000 })
  assert.deepEqual(v.mcp, [{ name: 'orbit', status: 'connected', source: 'sdk', error: undefined, tools: 2 }])
  assert.equal(v.limits[0].pct, 42)
  assert.equal(v.limits[0].resetsAt, '2026-11-09T18:00:00Z')
  assert.deepEqual([v.tokens?.input, v.tokens?.output, v.tokens?.cacheRead, v.tokens?.requests], [7, 3, 100, 1])
  assert.equal(v.engine.version, '9.9.9')
})

test('a tab with no process: the idle process answers; folder and session come from the window', async () => {
  const v = await threadStatusView({
    liveQuery: () => undefined, facts: () => null, transcript, status: status as any,
    idle: () => ({ accountInfo: async () => ({ email: 'me@example.com' }), mcpServerStatus: mcp }) as any,
  }, 'tab-2', { cwd: 'C:/r/app', sessionId: 'sess-none' })
  assert.equal(v.live, false)
  assert.equal(v.account.email, 'me@example.com')
  assert.equal(v.account.plan, 'max')
  assert.equal(v.context, null)
  assert.equal(v.sessionId, 'sess-none')
  assert.deepEqual([v.tokens?.requests, v.tokens?.complete], [0, true]) // no transcript yet
})

test('the / menu: what the engine reports, plus the CLI-only commands it leaves out; /status and /usage are views', () => {
  const engine = [{ name: 'compact', description: 'Compact', builtin: true }, { name: 'usage', description: 'Usage', aliases: ['cost'], builtin: true }, { name: 'my-skill', description: 'Mine' }]
  const m = menuCommands(engine)
  assert.deepEqual(m.slice(0, 3).map((c) => c.name), ['compact', 'usage', 'my-skill']) // the engine's list first, as is
  assert.equal(m.find((c) => c.name === 'usage')!.view, 'usage')
  assert.equal(m.filter((c) => c.name === 'usage').length, 1) // not added twice
  const login = m.find((c) => c.name === 'login')!
  assert.deepEqual([login.terminal, login.builtin], [true, true])
  assert.equal(m.find((c) => c.name === 'status')!.view, 'status')
  assert.equal(m.find((c) => c.name === 'my-skill')!.terminal, undefined)
})
