// With HIVE_TEST_MODE=1 (read once when testMode.ts loads) watchers can be created but nothing runs on its own.
import { beforeAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let w: typeof import('../../src/main/watchers')
let started = 0
let root = ''

beforeAll(async () => {
  process.env.HIVE_TEST_MODE = '1'
  const base = mkdtempSync(join(tmpdir(), 'hive-watchers-tm-'))
  root = join(base, 'watchers')
  process.env.HIVE_WATCHERS_DIR = root
  w = await import('../../src/main/watchers')
  w.initWatchers({}, base, {
    runThread: () => { started++; return true },
    threadState: () => null,
    closeThread: () => {},
    transcript: (cwd, sid) => `${cwd}/${sid}.jsonl`,
    usage: async () => ({ pct: 10, readAt: Date.now(), error: '' }),
  })
})

test('create writes the folder but starts nothing; run now and the tick stay off', async () => {
  const r = w.createWatcher({ name: 'T2', goal: 'g', schedule: '1h' }, 'test')
  assert.match(r.message, /test mode/)
  assert.ok(existsSync(join(root, 't2', 'watcher.json')))
  assert.match(w.runWatcherNow('t2'), /test mode/)
  await w.tick()
  assert.equal(started, 0)
})
