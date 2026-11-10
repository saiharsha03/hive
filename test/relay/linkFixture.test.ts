// Hive (mobileLink.ts) and the phone app (Link.kt) must seal and open the same blobs. Both test suites read one file,
// mobile/app/src/test/resources/link-fixture.json: here with mobileLink.ts, in the app with Link.kt (LinkTest.kt).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { notifyKey, open, seal, type Dir } from '../../src/main/mobileLink'

type Case = { name: string; dir: Dir; key?: 'pair' | 'notify'; blob: string; msg?: Record<string, unknown> }
const fx = JSON.parse(readFileSync(join(__dirname, '../../mobile/app/src/test/resources/link-fixture.json'), 'utf8')) as {
  key: string; notifyKey: string; pair: string; cases: Case[]; bad: Case[]; fromApp: Case[]
}
const key = Buffer.from(fx.key, 'base64')
const keyOf = (c: Case) => (c.key === 'notify' ? notifyKey(key) : key)

test('the notification key is derived the same way on both sides', () => {
  assert.equal(notifyKey(key).toString('base64'), fx.notifyKey)
  assert.notEqual(fx.notifyKey, fx.key)
})

test('blobs sealed by Hive open, with the right key, pair and direction only', () => {
  assert.ok(fx.cases.length >= 3)
  for (const c of fx.cases) assert.deepEqual(open(keyOf(c), fx.pair, c.dir, c.blob), c.msg, c.name)
})

test('a changed, cut, misdirected or wrongly keyed blob does not open', () => {
  assert.ok(fx.bad.length >= 10)
  for (const c of fx.bad) assert.equal(open(keyOf(c), fx.pair, c.dir, c.blob), null, c.name)
})

test('blobs sealed by the app (Link.kt) open in Hive', () => {
  assert.ok(fx.fromApp.length >= 2, 'the fixture has no blob sealed by the app')
  for (const c of fx.fromApp) assert.deepEqual(open(keyOf(c), fx.pair, c.dir, c.blob), c.msg, c.name)
})

test('every seal uses a fresh nonce', () => {
  const blobs = new Set(Array.from({ length: 50 }, () => seal(key, fx.pair, 'd2p', { seq: 1 }).slice(0, 16)))
  assert.equal(blobs.size, 50)
})
