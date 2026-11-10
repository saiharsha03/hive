// The Deploy wizard past its plan: a push ending, the landed watch, Retry, late errors and the step into prod.
import { describe, expect, it } from 'vitest'
import { fmtDuration, initial, step, type Action, type Wizard } from '../../src/shared/deployWizard'
import type { RepoDiff } from '../../src/shared/deployCore'

const commits = (repo: string, n: number) => Array.from({ length: n }, (_, i) => ({ sha: `${repo}${i}`, title: 't', author: 'a' }))
const diff = (repo: string, staging: number, prod = 0): RepoDiff => ({ repo, toStaging: commits(repo, staging), toProd: commits(repo, prod), migrations: false })
const groups = { api: ['api'], web: ['web'] }
const run = (w: Wizard, ...actions: Action[]) => actions.reduce((s, a) => step(s, a).state, w)
const diffs = (list: RepoDiff[], local = false): Action => ({ t: 'diffs', diffs: list, changelog: '', output: '', root: '', at: 1, local })

const reviewing = () => run(initial(), { t: 'pick', suite: 's', groups }, diffs([diff('api', 2), diff('web', 1)], true))
const deploying = () => run(reviewing(), { t: 'next' }, { t: 'yes', at: 2 })
const pushed = (watchId = 'w1'): Action => ({ t: 'deployEnd', ok: true, message: 'Pushed', sha: 'abc1234', watchId, at: 3 })
const watching = () => run(deploying(), pushed())

describe('deploy wizard: a push and its watch', () => {
  it('starts the first pending step on Yes', () => {
    const r = step(run(reviewing(), { t: 'next' }), { t: 'yes', at: 2 })
    expect(r.state.phase).toBe('deploying')
    expect(r.state.cur).toBe(0)
    expect(r.effect).toEqual({ kind: 'deploy', repo: 'api', target: 'staging' })
  })

  it('a push that ends well is watched, and its sha is kept', () => {
    const w = watching()
    expect(w.phase).toBe('watching')
    expect(w.watchId).toBe('w1')
    expect(w.steps[0]).toMatchObject({ status: 'pushed', sha: 'abc1234' })
  })

  it('a push that fails can be retried: the same step runs again', () => {
    const failed = run(deploying(), { t: 'deployEnd', ok: false, message: 'Deploy script failed', sha: '', watchId: '', at: 3 })
    expect(failed.phase).toBe('failed')
    expect(failed.error).toBe('Deploy script failed')
    const r = step(failed, { t: 'retry', at: 4 })
    expect(r.state.phase).toBe('deploying')
    expect(r.effect).toEqual({ kind: 'deploy', repo: 'api', target: 'staging' })
  })

  it('a push with no landed check waits for a manual confirm, then asks about the next repo', () => {
    const manual = run(deploying(), pushed(''))
    expect(manual.phase).toBe('manual')
    const next = step(manual, { t: 'confirmManual', at: 5 }).state
    expect(next.steps[0].status).toBe('confirmed')
    expect(next.phase).toBe('ask')
    expect(next.question).toContain('API is live on staging. Go ahead with web?')
  })

  it('deployEnd outside a deploy is ignored', () => {
    const w = reviewing()
    expect(step(w, pushed()).state).toBe(w)
  })

  it('landed: the step is done, the watcher is dismissed and the next repo is asked about', () => {
    const r = step(watching(), { t: 'watchDone', landed: true, note: 'landed on abc1234', at: 9 })
    expect(r.state.steps[0]).toMatchObject({ status: 'landed', endedAt: 9 })
    expect(r.state.phase).toBe('ask')
    expect(r.effect).toEqual({ kind: 'dismiss', id: 'w1' })
  })

  it('not landed: stuck, and Retry watches the same sha again', () => {
    const stuck = step(watching(), { t: 'watchDone', landed: false, note: 'stuck: not serving', at: 9 })
    expect(stuck.state.phase).toBe('stuck')
    expect(stuck.state.note).toBe('stuck: not serving')
    const r = step(stuck.state, { t: 'retry', at: 10 })
    expect(r.state.phase).toBe('watching')
    expect(r.state.watchId).toBe('')
    expect(r.effect).toEqual({ kind: 'watch', repo: 'api', target: 'staging', sha: 'abc1234' })
    // the re-watch gets its id, or fails to start and is stuck again (Retry is still there)
    expect(step(r.state, { t: 'watchId', id: 'w2' }).state.watchId).toBe('w2')
    const again = step(r.state, { t: 'error', error: 'aws not found', from: 'watch' }).state
    expect(again.phase).toBe('stuck')
    expect(again.note).toBe('aws not found')
  })

  it('Stop while watching dismisses the watcher', () => {
    const r = step(watching(), { t: 'stop' })
    expect(r.state.phase).toBe('stopped')
    expect(r.effect).toEqual({ kind: 'dismiss', id: 'w1' })
  })
})

describe('deploy wizard: errors', () => {
  it('diffs failing on the first load goes back to the picker', () => {
    const w = run(initial(), { t: 'pick', suite: 's', groups }, { t: 'error', error: 'no repos root' })
    expect(w.phase).toBe('pick')
    expect(w.error).toBe('no repos root')
  })

  it('the refresh failing behind the local view keeps the view and says why', () => {
    const w = step(reviewing(), { t: 'error', error: 'diffs.sh timed out' }).state
    expect(w.phase).toBe('review')
    expect(w.error).toBe('diffs.sh timed out')
    expect(w.steps).toHaveLength(2)
  })

  it('a late refresh failure never fails a running deploy: its deployEnd still counts, and nothing is pushed twice', () => {
    for (const a of [{ t: 'error', error: 'diffs.sh failed' }, { t: 'error', error: 'diffs.sh failed', from: 'refresh' }] as Action[]) {
      const during = step(deploying(), a)
      expect(during.state.phase).toBe('deploying')
      expect(during.effect).toBeUndefined()
      const after = step(during.state, pushed()).state
      expect(after.phase).toBe('watching')
      expect(after.watchId).toBe('w1')
      // Retry has nothing to redo here
      expect(step(during.state, { t: 'retry', at: 5 }).effect).toBeUndefined()
    }
  })

  it('a late refresh failure changes nothing while asking, watching or stuck either', () => {
    const asking = run(reviewing(), { t: 'next' })
    const stuck = run(watching(), { t: 'watchDone', landed: false, note: 'n', at: 9 })
    for (const w of [asking, watching(), stuck]) expect(step(w, { t: 'error', error: 'x', from: 'refresh' }).state).toBe(w)
    // and without the "from": a watch that has its id is not a re-watch being started
    expect(step(watching(), { t: 'error', error: 'x' }).state.phase).toBe('watching')
  })
})

describe('deploy wizard: into prod', () => {
  const stagingDone = () => run(
    watching(),
    { t: 'watchDone', landed: true, note: '', at: 9 }, { t: 'yes', at: 10 }, pushed('w2'), { t: 'watchDone', landed: true, note: '', at: 11 },
  )

  it('asks about prod once every staging step is done', () => {
    const w = stagingDone()
    expect(w.phase).toBe('ask')
    expect(w.toProd).toBe(true)
    expect(w.question).toBe('Staging done. Deploy to prod?')
  })

  it('Yes loads fresh diffs, then starts the first prod step', () => {
    const yes = step(stagingDone(), { t: 'yes', at: 12 })
    expect(yes.state.phase).toBe('loading')
    expect(yes.effect).toEqual({ kind: 'diffs', suite: 's', forProd: true })
    const r = step(yes.state, diffs([diff('api', 0, 2), diff('web', 0, 1)]))
    expect(r.state.phase).toBe('deploying')
    expect(r.state.toProd).toBe(false)
    expect(r.state.steps.map((s) => `${s.repo}:${s.env}:${s.status}`)).toEqual(['api:staging:landed', 'web:staging:landed', 'api:prod:pending', 'web:prod:pending'])
    expect(r.effect).toEqual({ kind: 'deploy', repo: 'api', target: 'prod' })
  })

  it('nothing for prod: done', () => {
    const w = run(stagingDone(), { t: 'yes', at: 12 }, diffs([diff('api', 0), diff('web', 0)]))
    expect(w.phase).toBe('done')
  })

  it('the prod diffs failing can be retried from the same question', () => {
    const failed = run(stagingDone(), { t: 'yes', at: 12 }, { t: 'error', error: 'git fetch failed' })
    expect(failed.phase).toBe('failed')
    const r = step(failed, { t: 'retry', at: 13 }).state
    expect(r.phase).toBe('ask')
    expect(r.question).toBe('Staging done. Deploy to prod?')
  })

  it('every prod step landed: done', () => {
    const w = run(
      stagingDone(), { t: 'yes', at: 12 }, diffs([diff('api', 0, 2), diff('web', 0)]),
      pushed('w3'), { t: 'watchDone', landed: true, note: '', at: 14 },
    )
    expect(w.phase).toBe('done')
  })
})

it('durations round to whole seconds before they are split', () => {
  expect(fmtDuration(null)).toBe('')
  expect(fmtDuration(45_400)).toBe('45s')
  expect(fmtDuration(59_600)).toBe('1m 0s')
  expect(fmtDuration(119_600)).toBe('2m 0s') // was "1m 60s"
  expect(fmtDuration(190_000)).toBe('3m 10s')
})
