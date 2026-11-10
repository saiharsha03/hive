// the session list re-reads only what changed, and search indexes a grown transcript from where it stopped
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hive-projects-'))
process.env.HIVE_PROJECTS_DIR = root
const sessions = await import('../../src/main/sessions')
const search = await import('../../src/main/search')

const u = (text: string, at: string) => JSON.stringify({ type: 'user', timestamp: at, cwd: 'C:/r/app', entrypoint: 'cli', message: { role: 'user', content: text } })
const a = (id: string, text: string, at: string) => JSON.stringify({ type: 'assistant', timestamp: at, message: { id, content: [{ type: 'text', text }] } })

test('the list re-reads a transcript only when its folder changed or a live thread touched it', async () => {
  const folder = join(root, 'C--r-app')
  mkdirSync(folder, { recursive: true })
  const f1 = join(folder, 's1.jsonl')
  writeFileSync(f1, u('first job', '2026-11-01T10:00:00Z') + '\n')
  let l = await sessions.listSessions()
  assert.deepEqual(l.map((x) => x.id), ['s1'])
  assert.equal(l[0].updated, Date.parse('2026-11-01T10:00:00Z'))
  // appended (as a thread does): the folder's time does not change, so the list does not look at it...
  appendFileSync(f1, a('m1', 'done', '2026-11-02T10:00:00Z') + '\n')
  l = await sessions.listSessions()
  assert.equal(l[0].updated, Date.parse('2026-11-01T10:00:00Z'))
  // ...until its thread reports a turn end
  sessions.sessionTouched(f1)
  l = await sessions.listSessions()
  assert.equal(l[0].updated, Date.parse('2026-11-02T10:00:00Z'))
  assert.equal(sessions.sessionStamp(f1)?.size, (await import('node:fs')).statSync(f1).size)
  // a new session in the folder changes the folder: it shows up
  writeFileSync(join(folder, 's2.jsonl'), u('second job', '2026-11-03T10:00:00Z') + '\n')
  l = await sessions.listSessions()
  assert.deepEqual(l.map((x) => x.id), ['s2', 's1'])
  // a full check (the periodic refresh) sees everything
  appendFileSync(f1, a('m2', 'later', '2026-11-04T10:00:00Z') + '\n')
  l = await sessions.listSessions({ full: true })
  assert.deepEqual(l.map((x) => x.id), ['s1', 's2'])
})

test('a grown transcript is indexed from the last indexed byte: new words found, nothing indexed twice', async () => {
  await search.searchInSession('warmup', 'none', 1) // loads whatever index the temp folder has
  const f = join(mkdtempSync(join(tmpdir(), 'hive-index-')), 'idx.jsonl')
  writeFileSync(f, [u('the zebracorn migration', '2026-11-01T10:00:00Z'), a('m1', 'working on the zebracorn', '2026-11-01T10:01:00Z')].join('\n') + '\n')
  const { statSync } = await import('node:fs')
  const st = () => { const s = statSync(f); return [s.size, s.mtimeMs] as const }
  await search.indexOne({ path: f, id: 'idx' }, ...st())
  assert.equal((await search.searchInSession('zebracorn', 'idx', 10))!.chunks.length, 2)
  // the same streamed message continues past the offset, a new one follows, and a half-written line ends the file
  appendFileSync(f, [a('m1', 'working on the zebracorn', '2026-11-01T10:01:00Z'), u('now the quokkafish', '2026-11-01T10:02:00Z')].join('\n') + '\n{"type":"user","message":{"content":"hal')
  await search.indexOne({ path: f, id: 'idx' }, ...st())
  assert.equal((await search.searchInSession('zebracorn', 'idx', 10))!.chunks.length, 2) // not twice
  assert.equal((await search.searchInSession('quokkafish', 'idx', 10))!.chunks.length, 1)
  assert.equal((await search.searchInSession('halfdone', 'idx', 10))!.chunks.length, 0)
  appendFileSync(f, 'fdone pangolinbird"}}\n')
  await search.indexOne({ path: f, id: 'idx' }, ...st())
  assert.equal((await search.searchInSession('pangolinbird', 'idx', 10))!.chunks.length, 1) // the finished line
  // rewritten shorter: indexed again from the start, the old words gone
  writeFileSync(f, u('only the axolotl now', '2026-11-05T10:00:00Z') + '\n')
  await search.indexOne({ path: f, id: 'idx' }, ...st())
  assert.equal((await search.searchInSession('zebracorn', 'idx', 10))!.chunks.length, 0)
  assert.equal((await search.searchInSession('axolotl', 'idx', 10))!.chunks.length, 1)
})
