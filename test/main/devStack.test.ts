// The real ensureWorktree / retireWorktree against a throwaway repo and a bare origin in a temp folder.
import { afterAll, beforeAll, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as dev from '../../src/main/devStack'
import { git, hasGit, tempDir } from '../support/tools'

const tmp = hasGit ? tempDir('devstack') : null
const ROOT = tmp?.dir ?? ''
const ORIGIN = path.join(ROOT, 'origin.git')
const MAIN = path.join(ROOT, 'repos', 'app')
const WTROOT = path.join(ROOT, 'repos', '.hive-worktrees')

function initRepo(dir: string) {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'commit.gpgsign', 'false')
}

describe.skipIf(!hasGit)('devStack worktrees (real git)', () => {
  beforeAll(() => {
    fs.mkdirSync(MAIN, { recursive: true })
    git(ROOT, 'init', '-q', '--bare', '-b', 'main', ORIGIN)
    initRepo(MAIN)
    fs.writeFileSync(path.join(MAIN, 'a.txt'), 'one\n')
    fs.writeFileSync(path.join(MAIN, '.gitignore'), 'node_modules\n') // .env deliberately NOT ignored
    git(MAIN, 'add', '.')
    git(MAIN, 'commit', '-q', '-m', 'init')
    git(MAIN, 'remote', 'add', 'origin', ORIGIN)
    git(MAIN, 'push', '-q', '-u', 'origin', 'main')
    git(MAIN, 'remote', 'set-head', 'origin', 'main')
    // an origin commit the main checkout has not fetched: a new branch must include it (fetch first)
    const other = path.join(ROOT, 'other')
    git(ROOT, 'clone', '-q', ORIGIN, other)
    git(other, 'config', 'user.email', 'test@example.com')
    git(other, 'config', 'user.name', 'Test')
    fs.writeFileSync(path.join(other, 'b.txt'), 'remote\n')
    git(other, 'add', '.')
    git(other, 'commit', '-q', '-m', 'remote change')
    git(other, 'push', '-q')
    fs.writeFileSync(path.join(MAIN, '.env'), 'SECRET=1\n')
    fs.mkdirSync(path.join(MAIN, 'node_modules', 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(MAIN, 'node_modules', 'pkg', 'index.js'), 'keep me')
    dev.init({
      path: '',
      message: '',
      env: {},
      config: { root: path.join(ROOT, 'repos'), agentsFolders: [], pullSkip: [], worktreesDir: WTROOT, stacks: [], services: [] },
    } as unknown as Parameters<typeof dev.init>[0])
  })
  afterAll(() => tmp?.cleanup())

  let wt: { path: string; branch: string; note: string }

  test('ticket -> new feat/ branch from freshly fetched origin/main, .env copied, node_modules linked, no upstream', async () => {
    wt = await dev.ensureWorktree('app', { ticket: 'PROJ-12 Fix login' })
    assert.equal(wt.branch, 'feat/PROJ-12-fix-login')
    assert.equal(path.resolve(wt.path), path.join(WTROOT, 'app', 'feat__PROJ-12-fix-login'))
    assert.equal(fs.readFileSync(path.join(wt.path, 'b.txt'), 'utf8').replace(/\r/g, ''), 'remote\n')
    assert.equal(fs.readFileSync(path.join(wt.path, '.env'), 'utf8'), 'SECRET=1\n')
    assert.ok(fs.lstatSync(path.join(wt.path, 'node_modules')).isSymbolicLink())
    assert.throws(() => git(wt.path, 'rev-parse', '--abbrev-ref', '@{u}'))
    assert.match(wt.note, /origin\/main/)
  })

  test('same ticket (other words) and same branch reuse the worktree', async () => {
    const again = await dev.ensureWorktree('app', { ticket: 'PROJ-12' })
    assert.equal(again.branch, wt.branch)
    assert.equal(path.resolve(again.path), path.resolve(wt.path))
    assert.match(again.note, /reused/)
    const byBranch = await dev.ensureWorktree('app', { branch: 'feat/PROJ-12-fix-login' })
    assert.equal(path.resolve(byBranch.path), path.resolve(wt.path))
  })

  test('refuses the main checkout branch and bad repos', async () => {
    await assert.rejects(dev.ensureWorktree('app', { branch: 'main' }), /main checkout/)
    await assert.rejects(dev.ensureWorktree('../x', { branch: 'a' }), /not a repo folder/)
    await assert.rejects(dev.ensureWorktree('nope', { branch: 'a' }), /not a git repo/)
  })

  test('retire: uncommitted work saved as WIP on the branch (never the .env copy), folder gone, branch and node_modules kept', async () => {
    fs.writeFileSync(path.join(wt.path, 'a.txt'), 'changed\n')
    fs.writeFileSync(path.join(wt.path, 'new.txt'), 'new\n')
    git(wt.path, 'rm', '-q', 'b.txt')
    const r = await dev.retireWorktree({ repo: 'app', path: wt.path, branch: wt.branch, at: 0 })
    assert.equal(r.done, true, r.note)
    assert.match(r.note, /WIP: auto-saved when thread closed/)
    assert.ok(!fs.existsSync(wt.path))
    assert.equal(git(MAIN, 'log', '-1', '--format=%s', wt.branch), 'WIP: auto-saved when thread closed')
    const files = git(MAIN, 'show', '--name-status', '--format=', wt.branch).split('\n').sort()
    assert.deepEqual(files, ['A\tnew.txt', 'D\tb.txt', 'M\ta.txt'])
    assert.equal(fs.readFileSync(path.join(MAIN, 'node_modules', 'pkg', 'index.js'), 'utf8'), 'keep me')
    assert.ok(git(MAIN, 'branch', '--list', wt.branch))
    assert.ok(!git(MAIN, 'worktree', 'list').includes('PROJ-12'))
  })

  test('retire again: already gone, done', async () => {
    const r = await dev.retireWorktree({ repo: 'app', path: wt.path, branch: wt.branch, at: 0 })
    assert.equal(r.done, true)
    assert.match(r.note, /already gone/)
  })

  test('clean worktree for an existing branch: removed without a commit', async () => {
    const before = git(MAIN, 'rev-parse', wt.branch)
    const w2 = await dev.ensureWorktree('app', { branch: wt.branch })
    assert.match(w2.note, /existing local branch/)
    const r = await dev.retireWorktree({ repo: 'app', path: w2.path, branch: w2.branch, at: 0 })
    assert.equal(r.done, true, r.note)
    assert.doesNotMatch(r.note, /WIP/)
    assert.equal(git(MAIN, 'rev-parse', wt.branch), before)
  })

  test('never deletes the main checkout', async () => {
    const r = await dev.retireWorktree({ repo: 'app', path: MAIN, branch: 'main', at: 0 })
    assert.equal(r.done, false)
    assert.match(r.note, /main checkout/)
    assert.ok(fs.existsSync(path.join(MAIN, 'a.txt')))
  })

  test('repo that ignores .env and node_modules, explicit local base, no origin', async () => {
    const m2 = path.join(ROOT, 'repos', 'app2')
    fs.mkdirSync(m2, { recursive: true })
    initRepo(m2)
    fs.writeFileSync(path.join(m2, '.gitignore'), 'node_modules\n.env*\n')
    fs.writeFileSync(path.join(m2, 'a.txt'), '1\n')
    git(m2, 'add', '.')
    git(m2, 'commit', '-q', '-m', 'init')
    fs.writeFileSync(path.join(m2, '.env.local'), 'S=1\n')
    fs.mkdirSync(path.join(m2, 'node_modules'))
    await assert.rejects(dev.ensureWorktree('app2', { branch: 'x' }), /default branch/)
    const w = await dev.ensureWorktree('app2', { branch: 'feat/x' }, 'main')
    assert.match(w.note, /from main/)
    fs.writeFileSync(path.join(w.path, 'a.txt'), '2\n')
    const r = await dev.retireWorktree({ repo: 'app2', path: w.path, branch: w.branch, at: 0 })
    assert.equal(r.done, true, r.note)
    assert.deepEqual(git(m2, 'show', '--name-only', '--format=', 'feat/x').split('\n'), ['a.txt'])
    assert.ok(fs.existsSync(path.join(m2, 'node_modules')))
  })

  test('a failing commit hook keeps the worktree', async () => {
    const w3 = await dev.ensureWorktree('app', { ticket: 'PROJ-13' })
    fs.writeFileSync(path.join(w3.path, 'x.txt'), 'x\n')
    const hooks = path.join(MAIN, '.git', 'hooks')
    fs.mkdirSync(hooks, { recursive: true })
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const r = await dev.retireWorktree({ repo: 'app', path: w3.path, branch: w3.branch, at: 0 })
    fs.rmSync(path.join(hooks, 'pre-commit'))
    assert.equal(r.done, false)
    assert.match(r.note, /could not auto-save/)
    assert.ok(fs.existsSync(path.join(w3.path, 'x.txt')))
  })
})
