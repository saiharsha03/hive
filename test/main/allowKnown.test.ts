// Allow my IP: every address the command succeeded for stays known, so home <-> office is no change
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { addKnown, allowState, forgetKnown, readKnown, trustMsOf } from '../../src/main/allowKnown'

const T = Date.parse('2026-11-09T12:00:00Z')
const home = { ip: '203.0.113.5', at: '2026-11-01T08:00:00Z' }
const office = { ip: '198.51.100.7', at: '2026-11-08T09:00:00Z' }

test('same address again, a second known address, a new one, an unreadable one', () => {
  const known = [office, home]
  assert.deepEqual(allowState('198.51.100.7', known, T, null), { changed: false, unreadable: false, match: office })
  assert.deepEqual(allowState('203.0.113.5', known, T, null).changed, false) // back home: already allowed
  assert.deepEqual(allowState('192.0.2.1', known, T, null), { changed: true, unreadable: false, match: null })
  assert.deepEqual(allowState(null, known, T, null), { changed: false, unreadable: true, match: null }) // not a change
  assert.equal(allowState('192.0.2.1', [], T, null).changed, true)
})

test('trust can run out (rules that expire on the other side); renewing it counts again', () => {
  const day = 24 * 3_600_000
  assert.equal(allowState(home.ip, [home], T, 3 * day).changed, true) // allowed 8 days ago, trusted 3
  assert.equal(allowState(office.ip, [office], T, 3 * day).changed, false)
  assert.equal(trustMsOf({ HIVE_ALLOWLIST_TRUST_HOURS: '72' }), 3 * day)
  for (const v of ['', '0', '-1', 'soon']) assert.equal(trustMsOf({ HIVE_ALLOWLIST_TRUST_HOURS: v }), null, v)
  assert.equal(trustMsOf({}), null)
})

test('the old single-address file reads as one known address; the new file keeps them all', () => {
  assert.deepEqual(readKnown(JSON.stringify({ ip: home.ip, at: home.at })), [home])
  assert.deepEqual(readKnown(JSON.stringify({ known: [office, home, { ip: 3 }] })), [office, home])
  assert.deepEqual(readKnown(null), [])
  assert.deepEqual(readKnown('{ broken'), [])
  assert.deepEqual(readKnown(JSON.stringify({ ip: null, at: null })), [])
})

test('allowing adds or renews an address (newest first); forgetting removes only that one', () => {
  const k = addKnown([home], office.ip, office.at)
  assert.deepEqual(k, [office, home])
  assert.deepEqual(addKnown(k, home.ip, '2026-11-09T11:00:00Z'), [{ ip: home.ip, at: '2026-11-09T11:00:00Z' }, office])
  assert.deepEqual(forgetKnown(k, office.ip), [home])
})
