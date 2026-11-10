import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  effectiveEnv, emptyGeneral, envForSave, isSecretKey, normalizeSettings, sectionOf, seedSettings, validateSettings, type Settings,
} from '../../src/shared/settingsCore'
import { DEFAULT_TIERS, parseTiers, pickTier } from '../../src/shared/watchCore'
import { loadSettings, saveSettings, threadDefaults } from '../../src/main/settings'
import { loadConfig, readDotEnv } from '../../src/main/devConfig'

// test/support/setup.ts points the store and the .env into this throwaway folder
const FIX = process.env.HIVE_TEST_STATE_DIR!

const DOT = {
  HIVE_REPOS_ROOT: 'C:/repos', HIVE_WATCH_DIR: 'C:/w', HIVE_WATCH_EVERY: '60m', HIVE_DEPENDABOT_REPOS: 'o/a,o/b',
  HIVE_DEPLOY_SUITES: 'app', HIVE_TRACKER_SITE: 'https://x', HIVE_TRACKER_TOKEN: 'shh', HIVE_TRACKER_TOKEN_FILE: '~/.tracker_token', SOME_API_KEY: 'k',
}
const SCRIPTS = [{ name: 'Report', cwd: 'C:/r', options: [{ label: 'Run', cmd: 'python main.py' }], open: '*.html' }, { name: 'broken' }]
const ok = (p: string) => ['C:/repos', 'C:/r', 'C:/w/watch.md'].includes(p.replace(/\\/g, '/'))
const draft = (env: Record<string, string>, scripts: unknown[] | null = null) => ({ env, scripts, general: emptyGeneral() })

test('secret-looking keys', () => {
  for (const k of ['HIVE_TRACKER_TOKEN', 'SOME_API_KEY', 'APIKEY', 'DB_PASSWORD', 'CLIENT_SECRET', 'PRIVATE_KEY']) assert.ok(isSecretKey(k), k)
  for (const k of ['HIVE_TRACKER_TOKEN_FILE', 'HIVE_REPOS_ROOT', 'HIVE_DEPLOY_SCRIPT', 'HIVE_SVC_API_ENV', 'KEY_PATH']) assert.ok(!isSecretKey(k), k)
})

test('seed from .env and scripts.json: every non-secret key, the scripts array as written', () => {
  const s = seedSettings(DOT, JSON.stringify(SCRIPTS))
  const { HIVE_TRACKER_TOKEN: _token, SOME_API_KEY: _key, ...rest } = DOT
  assert.deepEqual(s.env, rest)
  assert.deepEqual(s.scripts, SCRIPTS) // the bad entry is kept, so nothing is lost
  assert.deepEqual(s.general, {
    shell: '', model: '', effort: '', ui: '', theme: '', appName: 'Hive', appTagline: 'One desk, many agents', chrome: true, desktopNotify: true,
    bgModel: '', bgEffort: '', teamModel: '', teamEffort: '', idleCloseMinutes: 30, teamMemoryKb: 6,
  })
  assert.equal(seedSettings(DOT, null).scripts, null)
  assert.equal(seedSettings(DOT, 'not json').scripts, null)
  assert.equal(seedSettings(DOT, '{"a":1}').scripts, null)
})

test('the store wins, the .env is the fallback, secrets only from the .env', () => {
  const s: Settings = { version: 1, env: { HIVE_WATCH_EVERY: 'adaptive', HIVE_DEPLOY_SUITES: '', HIVE_TRACKER_TOKEN: 'evil' }, scripts: null, general: emptyGeneral() }
  const e = effectiveEnv(DOT, s)
  assert.equal(e.HIVE_WATCH_EVERY, 'adaptive')
  assert.equal(e.HIVE_DEPLOY_SUITES, '') // cleared in the store: no fallback
  assert.equal(e.HIVE_REPOS_ROOT, 'C:/repos') // not in the store: from the .env
  assert.equal(e.HIVE_TRACKER_TOKEN, 'shh')
})

test('saving: dropped .env keys become empty, secrets and bad names never saved', () => {
  const out = envForSave({ HIVE_REPOS_ROOT: 'D:/r', NEW_FLAG: 'x', HIVE_X_TOKEN: 't', 'bad key': 'y' }, DOT)
  assert.equal(out.HIVE_REPOS_ROOT, 'D:/r')
  assert.equal(out.NEW_FLAG, 'x')
  assert.equal(out.HIVE_WATCH_DIR, '')
  assert.ok(!('HIVE_X_TOKEN' in out) && !('HIVE_TRACKER_TOKEN' in out) && !('bad key' in out))
  const n = normalizeSettings({ env: { A: 'a', B: 3, HIVE_TRACKER_TOKEN: 'x' }, scripts: 'no', general: { effort: 'huge', model: ' m ' } })!
  assert.deepEqual(n, { version: 1, env: { A: 'a' }, scripts: null, general: { ...emptyGeneral(), model: 'm' } })
  assert.equal(normalizeSettings([]), null)
  // the idle close and the memory budget: whole numbers from 0, anything else the default
  const g = (general: object) => normalizeSettings({ general })!.general
  assert.equal(g({ idleCloseMinutes: 0 }).idleCloseMinutes, 0)
  assert.equal(g({ idleCloseMinutes: 45 }).idleCloseMinutes, 45)
  assert.equal(g({ idleCloseMinutes: -1 }).idleCloseMinutes, 30)
  assert.equal(g({ idleCloseMinutes: '10' }).idleCloseMinutes, 30)
  assert.equal(g({ teamMemoryKb: 12 }).teamMemoryKb, 12)
  assert.equal(g({ bgEffort: 'huge', teamEffort: 'low' }).bgEffort, '')
  assert.equal(g({ bgEffort: 'huge', teamEffort: 'low' }).teamEffort, 'low')
  assert.ok(validateSettings(draft({ HIVE_DEPENDABOT_MAX_REVIEWS: '0' }), ok).some((x) => x.key === 'HIVE_DEPENDABOT_MAX_REVIEWS'))
  assert.ok(!validateSettings(draft({ HIVE_DEPENDABOT_MAX_REVIEWS: '3' }), ok).some((x) => x.key === 'HIVE_DEPENDABOT_MAX_REVIEWS'))
})

test('sections', () => {
  assert.equal(sectionOf('HIVE_WATCH_TIERS'), 'watch')
  assert.equal(sectionOf('HIVE_DEPENDABOT_TIME'), 'dependabot')
  assert.equal(sectionOf('HIVE_DIFFS_SCRIPT'), 'deploy')
  assert.equal(sectionOf('HIVE_DEPLOY_WEB_PROD'), 'deploy')
  for (const k of ['HIVE_REPOS_ROOT', 'HIVE_PULL_SKIP', 'HIVE_STACKS', 'HIVE_STACK_APP_LABEL', 'HIVE_SVC_DB_PORT', 'HIVE_SERVICES']) assert.equal(sectionOf(k), 'dev', k)
  assert.equal(sectionOf('HIVE_TRACKER_QUERY'), 'other')
})

test('validators: times, repos, paths, ports, scripts, effort', () => {
  const v = (env: Record<string, string>, scripts: unknown[] | null = null) => validateSettings(draft(env, scripts), ok, 'C:/h')
  const keys = (ps: ReturnType<typeof v>, level: string) => ps.filter((p) => p.level === level).map((p) => p.key)
  assert.deepEqual(v({ HIVE_REPOS_ROOT: 'C:/repos', HIVE_WATCH_EVERY: 'adaptive', HIVE_WATCH_TIERS: '50:1h,100:1d', HIVE_WATCH_DAILY: '08:00', HIVE_WATCH_WEEKLY: 'Mon 08:00', HIVE_DEPENDABOT_REPOS: 'o/a', HIVE_DEPENDABOT_TIME: '12:00' }), [])
  assert.deepEqual(keys(v({ HIVE_DEPENDABOT_REPOS: 'o/a,just-a-name', HIVE_DEPENDABOT_TIME: '7pm' }), 'error'), ['HIVE_DEPENDABOT_REPOS', 'HIVE_DEPENDABOT_TIME'])
  assert.ok(keys(v({ HIVE_REPOS_ROOT: 'C:/nope' }), 'warn').includes('HIVE_REPOS_ROOT'))
  assert.deepEqual(keys(v({ HIVE_SVC_API_PORT: '99999' }), 'error'), ['HIVE_SVC_API_PORT'])
  const deploy = v({ HIVE_REPOS_ROOT: 'C:/repos', HIVE_DEPLOY_SUITES: 'app', HIVE_DEPLOY_SUITE_APP_API: 'api', HIVE_DEPLOY_SCRIPT: 'tools/deploy.sh' })
  assert.ok(deploy.some((p) => p.key === 'HIVE_DEPLOY_SCRIPT' && /C?:?.*tools.deploy\.sh|does not exist/.test(p.message)))
  const sc = v({}, SCRIPTS)
  assert.ok(sc.some((p) => p.key === 'scripts' && p.level === 'error' && /broken|cwd/.test(p.message)))
  assert.ok(!sc.some((p) => p.level === 'warn')) // C:/r exists
  assert.ok(v({}, [{ name: 'X', cwd: 'C:/gone', options: [{ label: 'a', cmd: 'b' }] }]).some((p) => p.level === 'warn' && p.key === 'scripts'))
  assert.deepEqual(keys(validateSettings({ ...draft({}), general: { ...emptyGeneral(), effort: 'huge' as any } }, ok), 'error'), ['general.effort'])
})

test('store file: first run seeds and saves; afterwards the store wins; a broken file is not overwritten', () => {
  const file = process.env.HIVE_SETTINGS_FILE!
  writeFileSync(process.env.HIVE_ENV_FILE!, 'HIVE_REPOS_ROOT=C:/repos\nHIVE_WATCH_DIR=C:/w\nHIVE_WATCH_EVERY=60m\nHIVE_X_TOKEN=shh\n')
  writeFileSync(join(FIX, 'scripts.json'), JSON.stringify(SCRIPTS))
  assert.ok(!existsSync(file))
  const dot = readDotEnv(FIX).env
  const s = loadSettings(dot, join(FIX, 'scripts.json'))
  assert.ok(existsSync(file))
  assert.ok(!readFileSync(file, 'utf8').includes('shh')) // the credential stayed in the .env
  assert.deepEqual(s.scripts, SCRIPTS)
  // a saved change wins over the .env from then on, and the loaded config carries it
  saveSettings({ ...s, env: { ...s.env, HIVE_WATCH_EVERY: 'adaptive', HIVE_WATCH_TIERS: '80:2h,100:1d' }, general: { ...emptyGeneral(), model: 'opus', effort: 'high' } })
  const again = loadSettings(readDotEnv(FIX).env, join(FIX, 'scripts.json'))
  assert.equal(again.env.HIVE_WATCH_EVERY, 'adaptive')
  const l = loadConfig(FIX, (env) => effectiveEnv(env, again))
  assert.equal(l.config!.root, 'C:/repos')
  assert.equal(l.env.HIVE_WATCH_TIERS, '80:2h,100:1d')
  assert.equal(l.env.HIVE_X_TOKEN, 'shh')
  assert.deepEqual(threadDefaults(), { model: 'opus', effort: 'high', extraArgs: { chrome: null } }) // Claude in Chrome is on by default
  // background and team defaults: empty = the main default, so nothing changes until they are set
  assert.deepEqual(threadDefaults('background'), threadDefaults())
  assert.deepEqual(threadDefaults('team'), threadDefaults())
  saveSettings({ ...again, general: { ...again.general, bgModel: 'haiku', bgEffort: 'low', teamEffort: 'medium' } })
  assert.deepEqual(threadDefaults('background'), { model: 'haiku', effort: 'low', extraArgs: { chrome: null } })
  assert.deepEqual(threadDefaults('team'), { model: 'opus', effort: 'medium', extraArgs: { chrome: null } })
  assert.deepEqual(threadDefaults('main'), { model: 'opus', effort: 'high', extraArgs: { chrome: null } })
  // test mode: Haiku at low effort and no Chrome, whatever the settings say
  for (const k of ['main', 'team', 'background'] as const) assert.deepEqual(threadDefaults(k, true), { model: 'haiku', effort: 'low' })
  saveSettings(again)
  // no .env at all: the store alone still configures Hive
  const envFile = process.env.HIVE_ENV_FILE
  process.env.HIVE_ENV_FILE = join(FIX, 'missing.env')
  const none = loadConfig(FIX, (env) => effectiveEnv(env, again))
  process.env.HIVE_ENV_FILE = envFile
  assert.equal(none.config!.root, 'C:/repos')
  assert.equal(none.env.HIVE_X_TOKEN, undefined)
  writeFileSync(file, '{ broken')
  const fallback = loadSettings(readDotEnv(FIX).env, join(FIX, 'scripts.json'))
  assert.equal(fallback.env.HIVE_WATCH_EVERY, '60m') // seeded again in memory
  assert.equal(readFileSync(file, 'utf8'), '{ broken') // left for the user to fix
})

test('tier parsing and picking: default table, boundaries, unreadable usage', () => {
  const t = parseTiers(DEFAULT_TIERS).tiers!
  assert.deepEqual(t.map((x) => x.below), [50, 60, 70, 100])
  const H = 3_600_000
  assert.equal(pickTier(t, 0).everyMs, H)
  assert.equal(pickTier(t, 49.9).everyMs, H)
  assert.equal(pickTier(t, 50).everyMs, 3 * H) // "below 50" is strict
  assert.equal(pickTier(t, 69).everyMs, 6 * H)
  assert.equal(pickTier(t, 100).everyMs, 24 * H) // at or above every threshold: the last tier
  assert.equal(pickTier(t, 140).tier, 3)
  assert.equal(pickTier(t, null).everyMs, 24 * H) // unreadable: slowest
  assert.equal(pickTier(parseTiers('50:1h,100:off').tiers!, null).everyMs, null) // off counts as slowest
  assert.equal(parseTiers('50:1h,50:2h').tiers, null)
  assert.match(parseTiers('50:1h,40:2h').problem, /rise/)
  assert.match(parseTiers('0:1h').problem, /between 1 and 100/)
  assert.match(parseTiers('50:soon').problem, /not like/)
  assert.equal(parseTiers('').tiers, null)
})

test('seeding from env: credentials stay out, defaults for the app name and tagline', () => {
  const s = seedSettings({ HIVE_REPOS_ROOT: 'C:/r', HIVE_GH_TOKEN: 'x', DB_PASSWORD: 'y', HIVE_TRACKER_TOKEN_FILE: '~/.t' }, null)
  assert.deepEqual(s.env, { HIVE_REPOS_ROOT: 'C:/r', HIVE_TRACKER_TOKEN_FILE: '~/.t' })
  assert.equal(s.general.appName, 'Hive')
  assert.equal(s.general.appTagline, 'One desk, many agents')
  const n = normalizeSettings({ general: { appName: '  ', appTagline: '' } })!
  assert.equal(n.general.appName, 'Hive') // empty name falls back
  assert.equal(n.general.appTagline, '') // an emptied tagline stays empty
  assert.equal(normalizeSettings({ general: { appName: 'Desk', ui: 'compact', theme: 'dark' } })!.general.appName, 'Desk')
})

test('validators: ids, kind, region, appearance, app name, tagline, credentials', () => {
  const v = (env: Record<string, string>, g: Partial<Settings['general']> = {}) => validateSettings({ env, scripts: null, general: { ...emptyGeneral(), ...g } }, ok, 'C:/h')
  const errs = (ps: ReturnType<typeof v>) => ps.filter((p) => p.level === 'error').map((p) => p.key)
  assert.deepEqual(errs(v({ HIVE_STACKS: 'app,bad id', HIVE_SERVICES: 'db', HIVE_SVC_DB_KIND: 'vm' })), ['HIVE_STACKS', 'HIVE_SVC_DB_KIND'])
  assert.deepEqual(errs(v({ HIVE_DEPLOY_REGION: 'us-east-1' })), [])
  assert.deepEqual(errs(v({ HIVE_DEPLOY_REGION: 'Virginia' })), ['HIVE_DEPLOY_REGION'])
  assert.deepEqual(errs(v({}, { ui: 'my ui', theme: 'ok-theme' })), ['general.ui'])
  assert.deepEqual(errs(v({}, { appName: ' ' })), ['general.appName'])
  assert.deepEqual(errs(v({}, { appTagline: 'x'.repeat(81) })), ['general.appTagline'])
  assert.deepEqual(errs(v({ HIVE_GH_TOKEN: 'x' })), ['HIVE_GH_TOKEN'])
  assert.deepEqual(errs(v({ HIVE_WATCH_TIERS: '50:1h,60:3h,70:6h,100:1d', HIVE_WATCH_EVERY: 'adaptive', HIVE_DEPENDABOT_REPOS: 'org/repo.js' })), [])
})
