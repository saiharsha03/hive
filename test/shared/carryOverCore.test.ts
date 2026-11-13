import { test } from 'vitest'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { carryOvers, skipOnCarry } from '../../src/shared/carryOverCore'

const home = join('C:', 'Users', 'me')
const appData = join(home, 'AppData', 'Roaming')

test("Hive's two places map to Orbit's: the state folder and Electron's storage", () => {
  assert.deepEqual(carryOvers({ home, appData, product: 'Orbit', stateFolder: '.orbit' }), [
    { kind: 'state', from: join(home, '.hive'), to: join(home, '.orbit') },
    { kind: 'userData', from: join(appData, 'Hive'), to: join(appData, 'Orbit') },
  ])
})

test('a place that would be copied onto itself is left out', () => {
  assert.deepEqual(carryOvers({ home, appData, product: 'Hive', stateFolder: '.hive' }), [])
})

test('locks and half-written files stay behind anywhere', () => {
  for (const r of ['Local Storage/leveldb/LOCK', 'hive/x.lock', 'hive-todos.json.hive-tmp', 'search/chunks.jsonl.tmp']) {
    assert.equal(skipOnCarry('userData', r), true, r)
  }
  assert.equal(skipOnCarry('state', 'hive-todos.json.hive-tmp'), true)
  assert.equal(skipOnCarry('state', 'hive\\watchers\\w1\\run.lock'), true)
})

test("Electron's caches, the lock and the rebuilt indexes stay behind; the page's storage comes along", () => {
  for (const r of ['lockfile', 'Cache', 'Code Cache/js/index', 'GPUCache', 'DawnGraphiteCache', 'search', 'search/manifest.json', 'models', 'sessions-cache.json', 'Crashpad/reports']) {
    assert.equal(skipOnCarry('userData', r), true, r)
  }
  for (const r of ['Local Storage', 'Local Storage/leveldb/000003.log', 'Preferences', 'IndexedDB', 'Session Storage/CURRENT']) {
    assert.equal(skipOnCarry('userData', r), false, r)
  }
})

test('the state folder comes along whole except the rewritten read-only guard', () => {
  assert.equal(skipOnCarry('state', 'hive/readonly-python'), true)
  assert.equal(skipOnCarry('state', 'hive\\readonly-python\\sitecustomize.py'), true)
  for (const r of ['hive-settings.json', 'hive-mobile.json', 'hive-threads.json', 'hive/thread-wakeups.db', 'hive/thread-wakeups.db-wal', 'hive/notes', 'hive/watchers/w1/memory.md', 'search', 'Cache']) {
    assert.equal(skipOnCarry('state', r), false, r)
  }
  assert.equal(skipOnCarry('state', ''), false)
})
