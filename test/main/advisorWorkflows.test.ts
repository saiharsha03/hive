// Advisor model and Workflows: the settings, what a session gets, a thread's own advisor, and workflow runs everywhere
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { emptyGeneral, normalizeSettings } from '../../src/shared/settingsCore'
import { idleCloseMs, idleSweepMs, saveSettings, sessionFlags } from '../../src/main/settings'
import { advisorNow, sessionOptions, setAdvisor } from '../../src/main/liveStatus'
import { permitWithoutPrompt } from '../../src/main/threadCore'
import { applyTask, kindLabel, taskHeading } from '../../src/shared/taskCore'
import { phoneTasks } from '../../src/shared/phoneCore'
import { whatOf } from '../../src/renderer/src/pages/runningCore'

test('settings: advisor model ("" = off) and Workflows (on, off, or Claude Code\'s default)', () => {
  const g = (general: object) => normalizeSettings({ general })!.general
  assert.deepEqual([emptyGeneral().advisorModel, emptyGeneral().workflows], ['', ''])
  assert.equal(g({ advisorModel: ' opus ' }).advisorModel, 'opus')
  assert.deepEqual(['on', 'off', 'maybe', true].map((w) => g({ workflows: w }).workflows), ['on', 'off', '', ''])
})

test('a new session gets them in the flag-settings layer; test mode adds no advisor', () => {
  saveSettings({ version: 1, env: {}, scripts: null, general: { ...emptyGeneral(), advisorModel: 'claude-opus-5-5', workflows: 'off' } })
  assert.deepEqual(sessionFlags(false), { advisorModel: 'claude-opus-5-5', enableWorkflows: false })
  assert.deepEqual(sessionFlags(true, {}), {})
  // a test run may name its own (the e2e that reads them back from the live process); outside test mode they are not read
  const own = { HIVE_TEST_ADVISOR: ' sonnet ', HIVE_TEST_WORKFLOWS: 'on' }
  assert.deepEqual(sessionFlags(true, own), { advisorModel: 'sonnet', enableWorkflows: true })
  assert.deepEqual(sessionFlags(true, { HIVE_TEST_WORKFLOWS: 'off' }), { enableWorkflows: false })
  assert.deepEqual(sessionFlags(true, { HIVE_TEST_WORKFLOWS: 'maybe' }), {})
  assert.deepEqual(sessionFlags(false, own), { advisorModel: 'claude-opus-5-5', enableWorkflows: false })
  // the idle limit in milliseconds, for test runs only; the sweep then runs as often as it takes to see it
  saveSettings({ version: 1, env: {}, scripts: null, general: { ...emptyGeneral(), idleCloseMinutes: 5 } })
  assert.equal(idleCloseMs(false, { HIVE_TEST_IDLE_CLOSE_MS: '2000' }), 5 * 60_000)
  assert.equal(idleCloseMs(true, {}), 5 * 60_000)
  assert.equal(idleCloseMs(true, { HIVE_TEST_IDLE_CLOSE_MS: '2000' }), 2000)
  assert.equal(idleCloseMs(true, { HIVE_TEST_IDLE_CLOSE_MS: 'soon' }), 5 * 60_000)
  assert.deepEqual([idleSweepMs(false, { HIVE_TEST_IDLE_CLOSE_MS: '2000' }), idleSweepMs(true, {}), idleSweepMs(true, { HIVE_TEST_IDLE_CLOSE_MS: '2000' })], [60_000, 60_000, 500])
  saveSettings({ version: 1, env: {}, scripts: null, general: emptyGeneral() })
  assert.deepEqual(sessionFlags(false), {}) // nothing set: nothing passed, Claude Code's own defaults stand
  const o = sessionOptions('adv-1', () => {}, { flags: { advisorModel: 'opus', enableWorkflows: true } })
  assert.equal((o.settings as Record<string, unknown>).advisorModel, 'opus')
  assert.equal((o.settings as Record<string, unknown>).enableWorkflows, true)
  assert.equal(advisorNow('adv-1'), 'opus')
  const off = sessionOptions('adv-2', () => {}, {})
  assert.equal('advisorModel' in (off.settings as object), false)
  assert.equal(advisorNow('adv-2'), null)
})

test("a thread's own advisor: switched live, and kept for its next process", async () => {
  const applied: unknown[] = []
  const events: unknown[] = []
  const q = { applyFlagSettings: async (s: unknown) => { applied.push(s) } } as any
  sessionOptions('adv-3', (e) => events.push(e), { flags: { advisorModel: 'opus' } })
  await setAdvisor('adv-3', q, 'sonnet')
  await setAdvisor('adv-3', q, '')
  // the process started with an advisor: clearing the key would bring that one back, so Off is an empty advisor
  assert.deepEqual(applied, [{ advisorModel: 'sonnet' }, { advisorModel: '' }])
  assert.deepEqual(events, [{ type: 'hive_advisor', model: 'sonnet' }, { type: 'hive_advisor', model: null }])
  const again = sessionOptions('adv-3', () => {}, { flags: { advisorModel: 'opus' } }) // the default does not come back
  assert.equal('advisorModel' in (again.settings as object), false)
  // that next process started with none: Off there drops Hive's flag, so the user's own settings apply
  await setAdvisor('adv-3', q, 'sonnet')
  await setAdvisor('adv-3', q, '')
  assert.deepEqual(applied.slice(2), [{ advisorModel: 'sonnet' }, { advisorModel: null }])
})

test('a Workflow call is never denied by Hive (auto mode can hand it over); a watcher keeps its rules', () => {
  assert.equal(permitWithoutPrompt('Workflow', false), true)
  assert.equal(permitWithoutPrompt('Workflow', true), false)
  assert.equal(permitWithoutPrompt('Bash', false), false)
})

test('a workflow run shows as kind Workflow with its name, in Activity, Running and on the phone', () => {
  const t = applyTask([], { type: 'system', subtype: 'task_started', task_id: 'w1', task_type: 'local_workflow', workflow_name: 'spec', description: 'Review the auth change' }, 1000)[0]
  assert.deepEqual([t.kind, t.name, t.status, kindLabel(t.kind)], ['local_workflow', 'spec', 'running', 'Workflow'])
  assert.equal(taskHeading(t), 'Workflow spec: Review the auth change')
  assert.equal(taskHeading({ kind: 'local_workflow', title: 'spec', name: 'spec' }), 'Workflow spec')
  assert.equal(taskHeading({ kind: 'local_agent', title: 'Explore', name: 'Explore' }), 'Explore')
  assert.equal(whatOf({ ...t, name: 'spec' }), 'spec: Review the auth change')
  assert.deepEqual(phoneTasks([t]), [{ id: 'w1', kind: 'Workflow', title: 'Workflow spec: Review the auth change', now: '' }])
  // its end comes through like any task's
  const done = applyTask([t], { type: 'system', subtype: 'task_notification', task_id: 'w1', status: 'completed', summary: 'ok' }, 2000)[0]
  assert.equal(done.status, 'completed')
})
