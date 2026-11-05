import { test } from 'vitest'
import assert from 'node:assert/strict'
import { allRepos, changelog, clusterFor, parseDeployConfig, parseDiffsOutput, serviceFull, serviceShort, suiteRepos, watchCommand, watchEnd, watchKind } from '../../src/shared/deployCore'
import { initial, planSteps, step } from '../../src/shared/deployWizard'

// ---------- deploy config ----------
const denv = {
  HIVE_DEPLOY_SUITES: 'core,ai', HIVE_DEPLOY_SUITE_CORE_LABEL: 'Core', HIVE_DEPLOY_SUITE_CORE_API: 'core-api', HIVE_DEPLOY_SUITE_CORE_WEB: 'core-web,admin-web',
  HIVE_DEPLOY_SUITE_AI_LABEL: 'AI', HIVE_DEPLOY_SUITE_AI_API: 'core-api,ai-api', HIVE_DEPLOY_SUITE_AI_WEB: 'ai-web',
  HIVE_DEPLOY_ORG: 'Org', HIVE_DEPLOY_SCRIPT: 'tools/deploy.sh', HIVE_DEPLOY_API_REPO: 'ai-api', HIVE_DEPLOY_API_CLUSTER: '{env}-ai',
  HIVE_DEPLOY_API_SERVICES: 'api,worker,scheduler', HIVE_DEPLOY_API_SERVICE_NAME: '{cluster}-{service}-service', HIVE_DEPLOY_WEB_REPO: 'ai-web',
  HIVE_DEPLOY_WEB_DEV: 'dev.example.com,EDEV', HIVE_DEPLOY_WEB_PROD: 'example.com,EPROD',
}
const diff = (repo: string, n: number) => ({
  repo, toStaging: Array.from({ length: n }, (_, i) => ({ sha: `${repo}${i}`, title: 't', author: 'a' })), toProd: [], migrations: false,
})

test('deploy config', () => {
  const c = parseDeployConfig(denv).config!
  assert.deepEqual(suiteRepos(c, 'core'), ['core-api', 'core-web', 'admin-web'])
  assert.deepEqual(suiteRepos(c, 'ai'), ['core-api', 'ai-api', 'ai-web'])
  assert.deepEqual(allRepos(c), ['core-api', 'core-web', 'admin-web', 'ai-api', 'ai-web'])
  assert.equal(c.region, 'us-east-1')
  const cl = clusterFor(c, 'staging')
  assert.equal(cl, 'staging-ai')
  assert.equal(serviceFull(c, cl, 'scheduler'), 'staging-ai-scheduler-service')
  assert.equal(serviceShort(c, cl, 'staging-ai-worker-service'), 'worker')
  assert.equal(watchKind('ai-api', c), 'api')
  assert.equal(watchKind('ai-web', c), 'web')
  assert.equal(watchKind('core-api', c), null)
  assert.deepEqual(c.web.dev, { host: 'dev.example.com', distribution: 'EDEV' })
  assert.equal(c.web.qa, undefined)
  assert.equal(parseDeployConfig({}).config, null)
  const msg = changelog('ai', [{ repo: 'ai-api', mainSha: 'b', prodSha: 'a', toStaging: [], toProd: [], migrations: false }], c.org)
  assert.ok(msg.includes('https://github.com/Org/ai-api/compare/a...b'))
})

test('diffsScript defaults next to the deploy script, override wins', () => {
  const base = { HIVE_DEPLOY_SUITES: 'a', HIVE_DEPLOY_SUITE_A_API: 'x' }
  assert.equal(parseDeployConfig({ ...base, HIVE_DEPLOY_SCRIPT: 'tools/deploy/deploy.sh' }).config!.diffsScript, 'tools/deploy/diffs.sh')
  assert.equal(parseDeployConfig({ ...base, HIVE_DEPLOY_SCRIPT: 'C:\\t\\deploy.sh' }).config!.diffsScript, 'C:\\t\\diffs.sh')
  assert.equal(parseDeployConfig({ ...base, HIVE_DEPLOY_SCRIPT: 'deploy.sh', HIVE_DIFFS_SCRIPT: 'other/d.sh' }).config!.diffsScript, 'other/d.sh')
})

// ---------- wizard ----------
test('wizard plans from the picked suite groups', () => {
  const c = parseDeployConfig(denv).config!
  const s = c.suites[1]
  const r = step(initial(), { t: 'pick', suite: s.id, groups: { api: s.api, web: s.web } })
  assert.equal(r.state.phase, 'loading')
  assert.deepEqual(r.effect, { kind: 'diffs', suite: 'ai', forProd: false })
  const steps = planSteps(r.state.groups, [diff('core-api', 0), diff('ai-api', 2), diff('ai-web', 1)], 'staging')
  assert.deepEqual(steps.map((x) => [x.repo, x.group, x.status]), [['core-api', 'api', 'skipped'], ['ai-api', 'api', 'pending'], ['ai-web', 'web', 'pending']])
})

test('wizard: local diffs first, then refresh swaps in fresh ones only while reviewing staging', () => {
  const groups = { api: ['ai-api'], web: ['ai-web'] }
  const loading = step(initial(), { t: 'pick', suite: 'ai', groups }).state
  const review = step(loading, { t: 'diffs', diffs: [diff('ai-api', 0), diff('ai-web', 0)], changelog: 'old', output: '', root: 'r', at: 1, local: true }).state
  assert.equal(review.phase, 'review')
  assert.match(review.note, /local refs, refreshing/)
  assert.deepEqual(review.steps.map((s) => s.status), ['skipped', 'skipped'])
  const fresh = step(review, { t: 'refresh', diffs: [diff('ai-api', 2), diff('ai-web', 0)], changelog: 'new', output: '', root: 'r' }).state
  assert.equal(fresh.note, '')
  assert.equal(fresh.changelog, 'new')
  assert.deepEqual(fresh.steps.map((s) => s.status), ['pending', 'skipped'])
  const deploying = { ...fresh, phase: 'deploying' as const }
  assert.equal(step(deploying, { t: 'refresh', diffs: [], changelog: 'x', output: '', root: 'r' }).state, deploying)
})

// ---------- diffs script output ----------
const P = 'd0ff74bff8b62e3f101a091faa2655f538aec70a'
const M = '78cbea3673f47109b25b488e09518d3ad79d9de5'
const S = '1111111111111111111111111111111111111111'
const HEAD = "I'm going to do a deploy shortly for the core suite, let me know if there are any concerns.\nChangelogs:\n"
const FOOT = '\n-----\nThe above message will be copied to clipboard.\n'
const body = [
  `core-api: https://github.com/Org/core-api/compare/${P}...${M} ⚠️ CONTAINS MIGRATIONS`,
  `core-web: https://github.com/Org/core-web/compare/${P}...${M}`,
  `  ⚠️ STAGING AHEAD OF PROD: 3 commit(s) deployed to staging but never to prod - they ship with this deploy: https://github.com/Org/core-web/compare/${P}...${S}`,
  'admin-web: No changes to deploy',
  'repo-a: repo not found at /c/x/deploy/../../repo-a',
  'repo-b: git fetch timed out or failed',
  'repo-c: failed to get origin/prod',
  'repo-d: failed to cd into /c/x/repo-d',
  '',
].join('\n')
const parsed = parseDiffsOutput(HEAD + body + FOOT)
const by = (k: string) => parsed.repos.find((x) => x.repo === k)!

test('diffs: message is everything above the footer, no trailing newline', () => {
  assert.equal(parsed.message, (HEAD + body).replace(/\n+$/, ''))
  assert.ok(!parsed.message.includes('-----'))
})
test('diffs: one entry per repo line, in order', () => {
  assert.deepEqual(parsed.repos.map((x) => x.repo), ['core-api', 'core-web', 'admin-web', 'repo-a', 'repo-b', 'repo-c', 'repo-d'])
})
test('diffs: compare URL, migrations and staging-ahead', () => {
  assert.deepEqual(by('core-api'), { repo: 'core-api', changes: true, url: `https://github.com/Org/core-api/compare/${P}...${M}`, prodSha: P, mainSha: M, migrations: true })
  assert.equal(by('core-web').changes, true)
  assert.equal(by('core-web').migrations, false)
  assert.deepEqual(by('core-web').stagingAhead, { count: 3, url: `https://github.com/Org/core-web/compare/${P}...${S}`, prodSha: P, stagingSha: S })
  assert.equal(by('core-api').stagingAhead, undefined)
  assert.deepEqual(by('admin-web'), { repo: 'admin-web', changes: false, migrations: false })
})
test('diffs: per-repo errors', () => {
  assert.equal(by('repo-a').error, 'repo not found at /c/x/deploy/../../repo-a')
  assert.equal(by('repo-b').error, 'git fetch timed out or failed')
  assert.equal(by('repo-c').error, 'failed to get origin/prod')
  assert.equal(by('repo-d').error, 'failed to cd into /c/x/repo-d')
  assert.equal(by('repo-d').changes, false)
})
test('diffs: CRLF, missing footer and usage text', () => {
  assert.deepEqual(parseDiffsOutput((HEAD + body + FOOT).replace(/\n/g, '\r\n')), parsed)
  assert.equal(parseDiffsOutput(HEAD + body).repos.length, 7)
  assert.equal(parseDiffsOutput('Usage: diffs.sh [core|ai]\n').repos.length, 0)
})

test('your own watch command: filled in, and landed only on exit 0 with DEPLOY DONE', () => {
  assert.equal(watchCommand('bash w.sh {env} {kind} {sha}', 'staging', 'api', 'abc1234'), 'bash w.sh staging api abc1234')
  assert.deepEqual(watchEnd(0, ['healthy check 4/4', 'DEPLOY DONE: api staging on abc1234']), { state: 'landed', note: 'DEPLOY DONE: api staging on abc1234' })
  assert.equal(watchEnd(1, ['CI deploy failure', 'DEPLOY FAILED: CircleCI job failed on staging', 'x']).note, 'DEPLOY FAILED: CircleCI job failed on staging')
  assert.equal(watchEnd(0, ['still waiting']).state, 'failed') // exit 0 without DEPLOY DONE is not landed
  assert.equal(watchEnd(2, []).note, 'the watch command exited with 2')
})
