// the Deploys page's pure parts: phases to zones, the three stages, what ships, the log, the matrix and the history
import { beforeEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { initial, step, type Wizard } from '../../src/shared/deployWizard'
import type { RepoDiff } from '../../src/shared/deployCore'
import { fold, getHistory, logLines, matrixOf, recordHistory, resetHistory, shipRows, stagesOf, tabState, targetOf, zoneOf, ZONE_OF } from '../../src/renderer/src/pages/deploysCore'

const c = (sha: string, title = 'Fix totals') => ({ sha, title, author: 'Ada' })
const diff = (repo: string, toStaging: number, toProd: number, over: Partial<RepoDiff> = {}): RepoDiff => ({
  repo, mainSha: 'aaaaaaa1111', stagingSha: 'bbbbbbb2222', prodSha: 'ccccccc3333', migrations: false,
  toStaging: Array.from({ length: toStaging }, (_, i) => c(`s${i}00000000`)), toProd: Array.from({ length: toProd }, (_, i) => c(`p${i}00000000`)), ...over,
})
const groups = { api: ['orders-api'], web: ['orders-web'] }
const clock = (t: number) => `t${t}`

function reviewing(diffs: RepoDiff[]): Wizard {
  let w = step(initial(), { t: 'pick', suite: 'orders', groups }).state
  w = step(w, { t: 'diffs', diffs, changelog: 'msg', output: 'out', root: '/r', at: 1 }).state
  return w
}
beforeEach(() => resetHistory())

test('every phase maps to a zone', () => {
  assert.equal(ZONE_OF.pick, 'pick')
  assert.equal(ZONE_OF.loading, 'load')
  assert.equal(ZONE_OF.review, 'review')
  assert.equal(ZONE_OF.ask, 'ask')
  for (const p of ['deploying', 'watching', 'stuck', 'manual', 'failed'] as const) assert.equal(ZONE_OF[p], 'run')
  assert.equal(ZONE_OF.done, 'end')
  assert.equal(ZONE_OF.stopped, 'end')
  assert.equal(zoneOf(initial()), 'pick')
})

test('review targets staging and the stages count what ships', () => {
  const w = reviewing([diff('orders-api', 3, 2), diff('orders-web', 1, 0)])
  assert.equal(zoneOf(w), 'review')
  assert.equal(targetOf(w), 'staging')
  const s = stagesOf(w, clock)!
  assert.equal(s.focus, 'orders-api')
  assert.deepEqual(s.stages.map((x) => x.state.word), ['AT', 'BEHIND', 'BEHIND'])
  assert.equal(s.connectors[0].label, '4 will ship')
  assert.equal(s.connectors[0].on, true)
  assert.equal(s.connectors[1].label, '2 commits')
  assert.equal(s.stages[1].on, true)
  assert.equal(s.stages[2].on, false)
  assert.equal(s.stages[0].sha, 'aaaaaaa')
})

test('nothing to ship reads as in sync', () => {
  const w = reviewing([diff('orders-api', 0, 0), diff('orders-web', 0, 0)])
  const s = stagesOf(w, clock)!
  assert.deepEqual(s.stages.map((x) => x.state.word), ['AT', 'LANDED', 'LANDED'])
  assert.equal(tabState(w, { id: 'orders', label: 'Orders', api: groups.api, web: groups.web })?.word, 'IN SYNC')
})

test('no stages before there is a diff, and tab words', () => {
  assert.equal(stagesOf(initial(), clock), null)
  const w = reviewing([diff('orders-api', 2, 0), diff('orders-web', 0, 0)])
  assert.equal(tabState(w, { id: 'orders', label: 'Orders', api: groups.api, web: groups.web })?.word, 'STAGING WAITING')
  assert.equal(tabState(w, { id: 'other', label: 'Other', api: ['x'], web: [] }), null)
  assert.equal(tabState(w, { id: 'empty', label: 'Empty', api: [], web: [] })?.word, 'NO TARGETS')
})

test('a running, failed and landed step colour the stage', () => {
  let w = reviewing([diff('orders-api', 2, 0), diff('orders-web', 0, 0)])
  w = step(w, { t: 'next' }).state
  assert.equal(zoneOf(w), 'ask')
  w = step(w, { t: 'yes', at: 100 }).state
  assert.equal(stagesOf(w, clock)!.stages[1].state.word, 'DEPLOYING')
  assert.equal(targetOf(w), 'staging')
  const failed = step(w, { t: 'deployEnd', ok: false, message: 'boom', sha: '', watchId: '', at: 110 }).state
  assert.equal(stagesOf(failed, clock)!.stages[1].state.word, 'FAILED')
  assert.equal(stagesOf(failed, clock)!.stages[1].rule, 'fail')
  const watching = step(w, { t: 'deployEnd', ok: true, message: '', sha: 'ddddddd4444', watchId: 'w1', at: 120 }).state
  const landed = step(watching, { t: 'watchDone', landed: true, note: '', at: 200 }).state
  const st = stagesOf(landed, clock)!.stages[1]
  assert.equal(st.state.word, 'LANDED')
  assert.equal(st.sha, 'ddddddd')
  assert.equal(st.line, 'Landed t200')
})

test('commits that will ship per target, errors and the fold', () => {
  const w = reviewing([diff('orders-api', 2, 5, { migrations: true }), diff('orders-web', 0, 0, { error: 'no remote' })])
  const s = shipRows(w, 'staging')
  assert.equal(s.rows.length, 2)
  assert.equal(s.rows[0].repo, 'orders-api')
  assert.deepEqual(s.migrations, ['orders-api'])
  assert.deepEqual(s.errors, [{ repo: 'orders-web', error: 'no remote' }])
  assert.equal(shipRows(w, 'prod').rows.length, 5)
  assert.equal(shipRows(w, null).rows.length, 0)
  const f = fold([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], false)
  assert.equal(f.shown.length, 8)
  assert.equal(f.more, 2)
  assert.equal(fold([1, 2, 3], false).more, 0)
  assert.equal(fold([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], true).shown.length, 10)
})

test('log lines pick up leading time stamps', () => {
  assert.deepEqual(logLines('13:52:07 pushing\n[13:53] done\nplain\n\n'), [
    { t: '13:52:07', text: 'pushing' }, { t: '13:53', text: 'done' }, { text: 'plain' },
  ])
  assert.deepEqual(logLines(''), [])
})

test('the all-repos matrix reads status cells', () => {
  const cell = (verdict: 'current' | 'behind' | 'unknown', served?: string) => ({ verdict, served, head: 'h', behind: verdict === 'behind' ? 3 : 0 })
  const m = matrixOf({ apiRepo: 'orders-api', webRepo: '' }, [
    { env: 'dev', api: cell('current', 'abcdef1234'), web: cell('unknown') },
    { env: 'prod', api: cell('behind', '1234567890'), web: cell('unknown') },
  ])
  assert.deepEqual(m.envs, ['dev', 'prod'])
  assert.equal(m.lines.length, 1)
  assert.deepEqual(m.lines[0].cells, [{ word: 'IN SYNC', tone: 'done', sha: 'abcdef1' }, { word: 'BEHIND', tone: 'wait', sha: '1234567' }])
})

test('history records finished and failed steps once, newest first', () => {
  let w = reviewing([diff('orders-api', 2, 0), diff('orders-web', 0, 0)])
  w = step(step(w, { t: 'next' }).state, { t: 'yes', at: 100 }).state
  assert.equal(recordHistory(w), false)
  const failed = step(w, { t: 'deployEnd', ok: false, message: 'boom', sha: '', watchId: '', at: 110 }).state
  assert.equal(recordHistory(failed), true)
  assert.equal(recordHistory(failed), false)
  assert.equal(getHistory()[0].result, 'failed')
  assert.equal(getHistory()[0].reason, 'boom')
  const retry = step(failed, { t: 'retry', at: 300 }).state
  const watching = step(retry, { t: 'deployEnd', ok: true, message: '', sha: 'ddddddd4444', watchId: 'w1', at: 320 }).state
  const landed = step(watching, { t: 'watchDone', landed: true, note: '', at: 400 }).state
  recordHistory(landed)
  const h = getHistory()
  assert.equal(h.length, 2)
  assert.equal(h[0].result, 'landed')
  assert.equal(h[0].tookMs, 100)
  assert.equal(h[0].landedAt, 400)
  assert.equal(h[1].result, 'failed')
})
