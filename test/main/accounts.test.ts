// Account profiles on temp folders only: no test reads or writes the real .credentials.json or ~/.claude.json
import { afterAll, beforeEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { listAccounts, profileId, realAccountPaths, removeAccount, saveCurrent, switchAccount, BACKUPS_KEPT, type AccountPaths } from '../../src/main/accounts'
import { tempDir } from '../support/tools'

const tmp = tempDir('accounts')
afterAll(() => tmp.cleanup())
let p: AccountPaths
let n = 0
const tok = (who: string, v = 1) => ({ accessToken: `at-${who}-${v}`, refreshToken: `rt-${who}-${v}`, expiresAt: 1, subscriptionType: 'max' })
const acct = (email: string) => ({ emailAddress: email, accountUuid: `u-${email}`, organizationName: 'Org', planDisplayName: 'Max' })
const mcp = { 'plugin:x|1': { accessToken: 'mcp-token' } }
const write = (creds: object, cj: object) => { writeFileSync(p.credentials, JSON.stringify(creds)); writeFileSync(p.claudeJson, JSON.stringify(cj, null, 2)) }
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'))

beforeEach(() => {
  const d = join(tmp.dir, `case${n++}`)
  mkdirSync(join(d, 'cfg'), { recursive: true })
  p = { credentials: join(d, 'cfg', '.credentials.json'), claudeJson: join(d, '.claude.json'), dir: join(d, 'accounts') }
})

test('the test paths are never the real files', () => {
  const real = realAccountPaths({})
  assert.equal(real.credentials, join(homedir(), '.claude', '.credentials.json'))
  assert.notEqual(p.credentials, real.credentials)
  assert.notEqual(p.claudeJson, real.claudeJson)
  assert.deepEqual(realAccountPaths({ CLAUDE_CONFIG_DIR: 'X:/cfg' }).claudeJson, join('X:/cfg', '.claude.json'))
})

test('saving the current login: a profile of the two keys only, and an index with no tokens', () => {
  write({ claudeAiOauth: tok('a'), mcpOAuth: mcp }, { oauthAccount: acct('a@example.com'), projects: { x: 1 } })
  const e = saveCurrent(p, 1000)!
  assert.equal(e.email, 'a@example.com')
  assert.equal(e.plan, 'Max')
  const prof = read(join(p.dir, `${e.id}.json`))
  assert.deepEqual(Object.keys(prof).sort(), ['claudeAiOauth', 'oauthAccount']) // no MCP tokens, no other state
  assert.doesNotMatch(readFileSync(join(p.dir, 'index.json'), 'utf8'), /at-a|rt-a/)
  assert.deepEqual(listAccounts(p).map((x) => [x.email, x.active]), [['a@example.com', true]])
  // no login: nothing saved
  write({ mcpOAuth: mcp }, {})
  assert.equal(saveCurrent(p), null)
})

test('a switch saves the current login first (its newest tokens), then swaps only the two keys', () => {
  write({ claudeAiOauth: tok('a'), mcpOAuth: mcp }, { oauthAccount: acct('a@example.com'), projects: { x: 1 } })
  saveCurrent(p, 1)
  write({ claudeAiOauth: tok('b'), mcpOAuth: mcp }, { oauthAccount: acct('b@example.com'), projects: { x: 1 } })
  saveCurrent(p, 2)
  // a's tokens rotated while b was active? no: b is live now and has rotated
  write({ claudeAiOauth: tok('b', 2), mcpOAuth: mcp }, { oauthAccount: acct('b@example.com'), projects: { x: 2 }, tips: 3 })
  const a = profileId('a@example.com')
  const b = profileId('b@example.com')
  const r = switchAccount(p, a, 10)
  assert.equal(r.changed, true)
  const creds = read(p.credentials)
  const cj = read(p.claudeJson)
  assert.equal(creds.claudeAiOauth.accessToken, 'at-a-1')
  assert.deepEqual(creds.mcpOAuth, mcp) // the MCP logins stay
  assert.equal(cj.oauthAccount.emailAddress, 'a@example.com')
  assert.deepEqual([cj.projects, cj.tips], [{ x: 2 }, 3]) // the CLI's own state stays
  assert.match(readFileSync(p.claudeJson, 'utf8'), /^\{\n {2}"/) // its formatting too
  assert.equal(read(join(p.dir, `${b}.json`)).claudeAiOauth.accessToken, 'at-b-2') // b's profile got the newest tokens
  assert.deepEqual(listAccounts(p).map((x) => [x.email, x.active]), [['a@example.com', true], ['b@example.com', false]])
  // back to b: b's rotated tokens
  switchAccount(p, b, 20)
  assert.equal(read(p.credentials).claudeAiOauth.accessToken, 'at-b-2')
  // to the one already active: nothing changes
  assert.equal(switchAccount(p, b, 30).changed, false)
})

test('a missing profile file fails before anything is touched', () => {
  write({ claudeAiOauth: tok('a'), mcpOAuth: mcp }, { oauthAccount: acct('a@example.com') })
  saveCurrent(p, 1)
  write({ claudeAiOauth: tok('b'), mcpOAuth: mcp }, { oauthAccount: acct('b@example.com') })
  saveCurrent(p, 2)
  const a = profileId('a@example.com')
  rmSync(join(p.dir, `${a}.json`))
  const before = [readFileSync(p.credentials, 'utf8'), readFileSync(p.claudeJson, 'utf8')]
  assert.throws(() => switchAccount(p, a), /missing; sign in to it with the browser again/)
  assert.deepEqual([readFileSync(p.credentials, 'utf8'), readFileSync(p.claudeJson, 'utf8')], before)
  assert.throws(() => switchAccount(p, 'nobody-123456'), /No saved account/)
  assert.throws(() => switchAccount(p, '../escape'), /No saved account|Not an account id/)
})

test('the second write failing puts the first back: both files still agree on who is signed in', () => {
  write({ claudeAiOauth: tok('a'), mcpOAuth: mcp }, { oauthAccount: acct('a@example.com') })
  saveCurrent(p, 1)
  write({ claudeAiOauth: tok('b'), mcpOAuth: mcp }, { oauthAccount: acct('b@example.com') })
  saveCurrent(p, 2)
  const credsBefore = readFileSync(p.credentials, 'utf8')
  // ~/.claude.json cannot be written (here: a folder stands where the file goes, on every system)
  rmSync(p.claudeJson)
  mkdirSync(p.claudeJson)
  assert.throws(() => switchAccount(p, profileId('a@example.com')), /nothing changed/)
  assert.equal(readFileSync(p.credentials, 'utf8'), credsBefore) // the tokens went back
})

test('backups: the last five switches are kept; removing an account deletes only its profile', () => {
  write({ claudeAiOauth: tok('a'), mcpOAuth: mcp }, { oauthAccount: acct('a@example.com') })
  saveCurrent(p, 1)
  write({ claudeAiOauth: tok('b'), mcpOAuth: mcp }, { oauthAccount: acct('b@example.com') })
  saveCurrent(p, 2)
  const a = profileId('a@example.com')
  const b = profileId('b@example.com')
  for (let i = 0; i < 8; i++) switchAccount(p, i % 2 ? b : a, 100 + i)
  const stamps = new Set(readdirSync(join(p.dir, 'backups')).map((f) => f.split('-')[0]))
  assert.equal(stamps.size, BACKUPS_KEPT)
  assert.ok(!stamps.has('100') && stamps.has('107'))
  const live = readFileSync(p.credentials, 'utf8')
  assert.equal(removeAccount(p, a), true)
  assert.ok(!existsSync(join(p.dir, `${a}.json`)))
  assert.equal(readFileSync(p.credentials, 'utf8'), live) // the engine's login is untouched
  assert.deepEqual(listAccounts(p).map((x) => x.email), ['b@example.com'])
  assert.equal(removeAccount(p, a), false)
})

test('other Claude sessions: the ones Hive did not start (a terminal, an IDE) are counted for the warning', async () => {
  const { othersOf } = await import('../../src/main/accounts')
  const hive = 100
  // 201, 202: Hive's threads; 203: a claude one of them started; 300: a terminal's; 301: started by that terminal session
  assert.equal(othersOf([[201, hive], [202, hive], [203, 201], [300, 50], [301, 300]], hive), 2)
  assert.equal(othersOf([], hive), 0)
})
