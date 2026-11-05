// A process that exited with an error stays "failed" until it is stopped again; that stop clears it.
import { afterAll, beforeAll, test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as dev from '../../src/main/devStack'
import { git, hasGit, tempDir } from '../support/tools'

const tmp = tempDir('devstop')
const state = (name: string) => dev.snapshot().services.find((s) => s.name === name)?.state

beforeAll(() => {
  fs.mkdirSync(path.join(tmp.dir, 'app'))
  git(path.join(tmp.dir, 'app'), 'init', '-q', '-b', 'main')
  const svc = { name: 'web', label: 'web', repo: 'app', kind: 'process', cmd: 'node -e "process.exit(1)"', python: '', port: 59997, open: false, env: {}, envFile: '' }
  dev.init({
    path: '',
    message: '',
    env: {},
    config: { root: tmp.dir, agentsFolders: [], pullSkip: [], worktreesDir: path.join(tmp.dir, 'wt'), stacks: [], services: [svc] },
  } as unknown as Parameters<typeof dev.init>[0])
})
afterAll(() => tmp.cleanup())

test.skipIf(!hasGit)('stopping a failed process clears it; only its owner (or the user) can', async () => {
  const owner = { kind: 'thread' as const, id: 't1', title: 'T1' }
  await dev.startService('web', { kind: 'main' }, owner)
  for (let i = 0; i < 100 && state('web') !== 'failed'; i++) await new Promise((r) => setTimeout(r, 50))
  assert.equal(state('web'), 'failed')
  assert.match(await dev.stopService('web', { kind: 'thread', id: 't2', title: 'T2' }), /in use by/)
  assert.equal(state('web'), 'failed')
  assert.equal(await dev.stopService('web', dev.USER), 'web: cleared')
  assert.equal(state('web'), 'stopped')
})
