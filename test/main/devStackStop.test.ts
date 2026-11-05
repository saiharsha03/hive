// Dev stack processes: failed rows can be cleared, worktree runs skip pnpm's deps check, a thread can start part of a stack.
import { afterAll, beforeAll, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as dev from '../../src/main/devStack'
import { git, hasGit, tempDir } from '../support/tools'

const tmp = tempDir('devstop')
const APP = path.join(tmp.dir, 'app')
const WT = path.join(tmp.dir, 'wt', 'app-x')
const state = (name: string) => dev.snapshot().services.find((s) => s.name === name)?.state
const settled = async (name: string) => {
  for (let i = 0; i < 100 && state(name) === 'starting'; i++) await new Promise((r) => setTimeout(r, 50))
  return state(name)
}
// exits 0 (-> stopped) only when the env skips pnpm's pre-run deps check
const checkEnv = 'node -e "process.exit(process.env.pnpm_config_verify_deps_before_run === \'false\' ? 0 : 1)"'
const svc = (name: string, cmd: string, port: number) => ({ name, label: name, repo: 'app', kind: 'process', cmd, python: '', port, open: false, env: {}, envFile: '' })
const t1 = { kind: 'thread' as const, id: 't1', title: 'T1' }

describe.skipIf(!hasGit)('dev stack processes', () => {
  beforeAll(() => {
    fs.mkdirSync(APP, { recursive: true })
    git(APP, 'init', '-q', '-b', 'main')
    git(APP, 'config', 'user.email', 'test@example.com')
    git(APP, 'config', 'user.name', 'Test')
    git(APP, 'commit', '-q', '--allow-empty', '-m', 'init')
    git(APP, 'worktree', 'add', '-q', '-b', 'x', WT)
    dev.init({
      path: '',
      message: '',
      env: {},
      config: {
        root: tmp.dir, agentsFolders: [], pullSkip: [], worktreesDir: path.join(tmp.dir, 'wt'),
        stacks: [{ id: 's', label: 's', services: ['web', 'env', 'api'] }],
        services: [svc('web', 'node -e "process.exit(1)"', 59997), svc('env', checkEnv, 59996), svc('api', 'node -e "process.exit(1)"', 59995)],
      },
    } as unknown as Parameters<typeof dev.init>[0])
  })
  afterAll(() => tmp.cleanup())

  test('stopping a failed process clears it; only its owner (or the user) can', async () => {
    await dev.startService('web', { kind: 'main' }, t1)
    assert.equal(await settled('web'), 'failed')
    assert.match(await dev.stopService('web', { kind: 'thread', id: 't2', title: 'T2' }), /in use by/)
    assert.equal(state('web'), 'failed')
    assert.equal(await dev.stopService('web', dev.USER), 'web: cleared')
    assert.equal(state('web'), 'stopped')
  })

  test("a thread's stack stop clears its own failed rows", async () => {
    await dev.startService('web', { kind: 'main' }, t1)
    assert.equal(await settled('web'), 'failed')
    await dev.agentStack('s', undefined, 'stop', t1, ['web'])
    assert.equal(state('web'), 'stopped')
  })

  test('the main checkout keeps pnpm deps checks; a worktree skips them', async () => {
    await dev.startService('env', { kind: 'main' }, t1)
    assert.equal(await settled('env'), 'failed')
    await dev.stopService('env', t1)
    await dev.startService('env', { kind: 'worktree', path: WT }, t1)
    assert.equal(await settled('env'), 'stopped')
  })

  test('services starts only the named part of the stack', async () => {
    assert.match(await dev.agentStack('s', undefined, 'start', t1, ['nope']), /Not in stack s: nope/)
    await dev.agentStack('s', undefined, 'start', t1, ['web'])
    assert.equal(state('web'), 'failed')
    assert.equal(state('api'), 'stopped')
  })
})
