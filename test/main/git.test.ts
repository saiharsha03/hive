// Real git against a throwaway workspace in a temp folder: a repo, a bare "origin", and a worktree.
import { afterAll, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import * as g from '../../src/main/git'
import { parseUnifiedDiff } from '../../src/shared/gitCore'
import { hasGit, tempDir } from '../support/tools'

const tmp = hasGit ? tempDir('git') : null
afterAll(() => tmp?.cleanup())
const SCRATCH = tmp?.dir ?? ''
const WS = join(SCRATCH, 'ws')
const REPO = join(WS, 'demo')
const ORIGIN = join(SCRATCH, 'origin.git')
const WT = join(SCRATCH, 'wt-demo-side')
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })

describe.skipIf(!hasGit)('git panel (real git)', () => {
  test('git panel operations on a throwaway repo', async () => {
    for (const d of [WS, ORIGIN, WT]) rmSync(d, { recursive: true, force: true })
    mkdirSync(REPO, { recursive: true })
    sh(SCRATCH, 'init', '-q', '--bare', ORIGIN)
    sh(REPO, 'init', '-q', '-b', 'main')
    sh(REPO, 'config', 'user.name', 'Test'); sh(REPO, 'config', 'user.email', 'test@example.com'); sh(REPO, 'config', 'core.autocrlf', 'false'); sh(REPO, 'config', 'core.hooksPath', '.git/hooks'); sh(REPO, 'config', 'commit.gpgsign', 'false')
    sh(REPO, 'remote', 'add', 'origin', ORIGIN)
    g.initGit({ config: { root: WS, agentsFolders: [], pullSkip: [] } as any, message: '', path: '', env: {} })

    // before the first commit: list, untracked, stage / unstage without HEAD
    writeFileSync(join(REPO, 'a.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(REPO, 'b c.txt'), 'spaced\n')
    let rows = await g.gitList()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].branch, 'main')
    assert.equal(rows[0].changes, 2)
    let d = await g.gitDetail(REPO)
    assert.deepEqual(d.untracked.map((e) => e.path).sort(), ['a.txt', 'b c.txt'])
    const untrackedDiff = parseUnifiedDiff(await g.gitDiff(REPO, 'a.txt', 'untracked', false))
    assert.equal(untrackedDiff[0].hunks[0].lines.length, 3)
    await g.gitStage(REPO, ['a.txt'])
    d = await g.gitDetail(REPO)
    assert.deepEqual(d.staged.map((e) => `${e.letter} ${e.path} +${e.add}`), ['A a.txt +3'])
    await g.gitUnstage(REPO, ['a.txt']) // no HEAD yet: rm --cached path
    d = await g.gitDetail(REPO)
    assert.equal(d.staged.length, 0)
    assert.ok(existsSync(join(REPO, 'a.txt')))
    assert.deepEqual(await g.gitLog(REPO), [])

    // stage all + commit
    await g.gitStageAll(REPO)
    await assert.rejects(g.gitCommit(REPO, '   '), /commit message/)
    const out = await g.gitCommit(REPO, 'First commit')
    assert.match(out, /First commit/)
    const log = await g.gitLog(REPO)
    assert.equal(log.length, 1)
    assert.equal(log[0].title, 'First commit')
    const show = parseUnifiedDiff(await g.gitShow(REPO, log[0].sha))
    assert.deepEqual(show.map((f) => f.path).sort(), ['a.txt', 'b c.txt'])

    // a pre-commit hook runs (never skipped) and can block the commit
    mkdirSync(join(REPO, '.git', 'hooks'), { recursive: true })
    const hook = join(REPO, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "hook ran: blocked" >&2\nexit 1\n'); chmodSync(hook, 0o755)
    writeFileSync(join(REPO, 'a.txt'), 'one\nTWO\nthree\n')
    await g.gitStage(REPO, ['a.txt'])
    await assert.rejects(g.gitCommit(REPO, 'blocked'), /hook ran: blocked/)
    rmSync(hook)

    // staged vs unstaged diff of the same file
    writeFileSync(join(REPO, 'a.txt'), 'one\nTWO\nthree\nfour\n')
    d = await g.gitDetail(REPO)
    assert.deepEqual(d.staged.map((e) => e.letter + e.path), ['Ma.txt'])
    assert.deepEqual(d.unstaged.map((e) => e.letter + e.path), ['Ma.txt'])
    const staged = parseUnifiedDiff(await g.gitDiff(REPO, 'a.txt', 'staged', false))[0]
    assert.deepEqual(staged.hunks[0].lines.filter((l) => l.t !== ' ').map((l) => l.t + l.text), ['-two', '+TWO'])
    const unstaged = parseUnifiedDiff(await g.gitDiff(REPO, 'a.txt', 'unstaged', true))[0]
    assert.deepEqual(unstaged.hunks[0].lines.filter((l) => l.t !== ' ').map((l) => l.t + l.text), ['+four'])
    await g.gitStage(REPO, ['a.txt'])
    await g.gitCommit(REPO, 'Second commit')

    // branches: create from HEAD, list, switch; switching with conflicting changes shows git's error and changes nothing
    assert.match(await g.gitCreateBranch(REPO, 'feat/one'), /feat\/one/)
    assert.deepEqual((await g.gitBranches(REPO)), { current: 'feat/one', branches: ['feat/one', 'main'] })
    await assert.rejects(g.gitCreateBranch(REPO, 'bad..name'), /not a valid branch name|bad\.\.name/i)
    await assert.rejects(g.gitCreateBranch(REPO, '-x'), /valid branch/)
    writeFileSync(join(REPO, 'a.txt'), 'feature line\n')
    await g.gitStage(REPO, ['a.txt'])
    await g.gitCommit(REPO, 'Feature change')
    writeFileSync(join(REPO, 'a.txt'), 'uncommitted edit\n')
    await assert.rejects(g.gitSwitch(REPO, 'main'), /would be overwritten|commit your changes or stash/i)
    assert.equal((await g.gitBranches(REPO)).current, 'feat/one')
    sh(REPO, 'stash', '-q') // test cleanup only; the panel has no stash / discard
    await g.gitSwitch(REPO, 'main')
    assert.equal((await g.gitBranches(REPO)).current, 'main')
    await assert.rejects(g.gitSwitch(REPO, 'nope'), /No local branch/)

    // push: no upstream -> -u origin <branch>; then plain push
    let p = await g.gitPush(REPO)
    assert.match(p, /^\$ git push -u origin main/)
    rows = await g.gitList()
    assert.equal(rows[0].upstream, 'origin/main')
    writeFileSync(join(REPO, 'c.txt'), 'c\n')
    await g.gitStage(REPO, ['c.txt']); await g.gitCommit(REPO, 'Third')
    rows = await g.gitList()
    assert.equal(rows[0].ahead, 1)
    p = await g.gitPush(REPO)
    assert.match(p, /^\$ git push\n/)
    assert.equal((await g.gitList())[0].ahead, 0)
    assert.match(await g.gitFetch(REPO), /.+/)

    // a worktree of a listed repo is listed and usable; a folder Orbit does not list is refused
    sh(REPO, 'worktree', 'add', '-q', WT, 'feat/one')
    rows = await g.gitList()
    const wt = rows.find((r) => r.worktree)!
    assert.ok(wt, 'worktree row')
    assert.equal(wt.branch, 'feat/one')
    assert.equal(wt.name, 'demo / wt-demo-side')
    assert.equal((await g.gitBranches(WT)).current, 'feat/one')
    await assert.rejects(g.gitDetail(SCRATCH), /not a repo or worktree Orbit(?: Next)? lists/)
    await assert.rejects(g.gitStage(REPO, ['../outside.txt']), /Not a path inside the repo/)
    await assert.rejects(g.gitDiff(REPO, join(SCRATCH, 'outside.txt'), 'untracked', false), /Not a path inside the repo/)
    await assert.rejects(g.gitShow(REPO, '--all'), /Not a commit id/)

    // locating a file the agent edited: the repo or worktree it is in, and its path inside it
    assert.deepEqual(await g.gitLocate(join(REPO, 'sub', 'x.ts').replace(/\//g, '\\')), { dir: REPO, name: 'demo', path: 'sub/x.ts' })
    assert.deepEqual(await g.gitLocate(`${WT}/a.txt`), { dir: wt.dir, name: 'demo / wt-demo-side', path: 'a.txt' })
    assert.equal(await g.gitLocate(join(SCRATCH, 'elsewhere.txt')), null)

    // a file name with glob characters is that one file, not a pattern ([id] would also match i.tsx and d.tsx)
    mkdirSync(join(REPO, 'pages'), { recursive: true })
    for (const f of ['[id].tsx', 'i.tsx', 'd.tsx']) writeFileSync(join(REPO, 'pages', f), `${f}\n`)
    await g.gitStage(REPO, ['pages/[id].tsx'])
    d = await g.gitDetail(REPO)
    assert.deepEqual(d.staged.map((e) => e.path), ['pages/[id].tsx'])
    assert.match(await g.gitDiff(REPO, 'pages/[id].tsx', 'staged', false), /\+\[id\]\.tsx/)
    await g.gitUnstage(REPO, ['pages/[id].tsx'])
    d = await g.gitDetail(REPO)
    assert.equal(d.staged.length, 0)
  })
})
