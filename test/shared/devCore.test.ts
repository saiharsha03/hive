// Dev stack and Pull latest, the pure parts: the .env reader, the worktrees folder, pull decisions, worktree names.
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { parseDevConfig, parseEnvFile, parseWorktrees, planPull, validBranchName, worktreeDir, type RepoFacts } from '../../src/shared/devCore'

describe('parseEnvFile', () => {
  it('reads KEY=VALUE lines, comments, export and CRLF', () => {
    expect(parseEnvFile('# top\r\nA=1\r\n\r\nexport B = two words \nbad line\n9X=no\n')).toEqual({ A: '1', B: 'two words' })
  })
  it('takes the quotes off a quoted value, also when a comment follows it', () => {
    expect(parseEnvFile('A="C:/My Repos"')).toEqual({ A: 'C:/My Repos' })
    expect(parseEnvFile("A='single'")).toEqual({ A: 'single' })
    expect(parseEnvFile('A="C:/My Repos" # the root')).toEqual({ A: 'C:/My Repos' }) // the quotes used to stay
    expect(parseEnvFile('A="C:/My Repos"   ')).toEqual({ A: 'C:/My Repos' })
    expect(parseEnvFile('URL="postgres://u:p@h/db#frag" # local')).toEqual({ URL: 'postgres://u:p@h/db#frag' })
    expect(parseEnvFile('A=""')).toEqual({ A: '' })
  })
  it('keeps a # inside quotes, and a value with quotes in the middle as written', () => {
    expect(parseEnvFile('CMD="npm run dev -- --tag #1"')).toEqual({ CMD: 'npm run dev -- --tag #1' })
    expect(parseEnvFile('A="a" "b"')).toEqual({ A: 'a" "b' })
    expect(parseEnvFile('A=say "hi" now')).toEqual({ A: 'say "hi" now' })
    expect(parseEnvFile('A="unclosed')).toEqual({ A: '"unclosed' })
  })
  it('unquoted: a space and # start a comment, a # without the space does not', () => {
    expect(parseEnvFile('A=value # note')).toEqual({ A: 'value' })
    expect(parseEnvFile('COLOR=#fff')).toEqual({ COLOR: '#fff' })
    expect(parseEnvFile('A=a#b')).toEqual({ A: 'a#b' })
  })
})

describe('parseDevConfig: the worktrees folder', () => {
  const root = resolve('/repos')
  it('defaults to .hive-worktrees under the root, also when the setting is cleared', () => {
    expect(parseDevConfig({ HIVE_REPOS_ROOT: root }).config!.worktreesDir).toBe(resolve(root, '.hive-worktrees'))
    // '' is what Settings saves for a cleared field: it must never resolve to the root itself
    expect(parseDevConfig({ HIVE_REPOS_ROOT: root, HIVE_WORKTREES_DIR: '' }).config!.worktreesDir).toBe(resolve(root, '.hive-worktrees'))
    expect(parseDevConfig({ HIVE_REPOS_ROOT: root, HIVE_WORKTREES_DIR: '  ' }).config!.worktreesDir).toBe(resolve(root, '.hive-worktrees'))
  })
  it('takes a relative or an absolute folder', () => {
    expect(parseDevConfig({ HIVE_REPOS_ROOT: root, HIVE_WORKTREES_DIR: 'wt' }).config!.worktreesDir).toBe(resolve(root, 'wt'))
    expect(parseDevConfig({ HIVE_REPOS_ROOT: root, HIVE_WORKTREES_DIR: resolve('/elsewhere') }).config!.worktreesDir).toBe(resolve('/elsewhere'))
  })
  it('needs a repos root', () => {
    expect(parseDevConfig({})).toEqual({ config: null, problems: ['HIVE_REPOS_ROOT is not set'] })
  })
})

describe('planPull', () => {
  const facts = (over: Partial<RepoFacts> = {}): RepoFacts => ({ dirty: false, current: 'main', defaultBranch: 'main', unpushed: 0, behind: 0, ...over })
  it('skips what it must not touch', () => {
    expect(planPull(facts({ fetchError: 'no network' }))).toMatchObject({ action: 'skip', message: 'failed: no network' })
    expect(planPull(facts({ defaultBranch: null })).action).toBe('skip')
    expect(planPull(facts({ dirty: true }))).toMatchObject({ action: 'skip', message: 'skipped: uncommitted changes' })
    expect(planPull(facts({ current: 'feat/x', unpushed: 2 }))).toMatchObject({ action: 'skip', message: 'skipped: on branch feat/x with unpushed commits' })
    expect(planPull(facts({ current: null, unpushed: 1 })).message).toBe('skipped: on branch detached HEAD with unpushed commits')
  })
  it('does nothing when the default branch is current and up to date', () => {
    expect(planPull(facts())).toEqual({ action: 'none', message: 'already up to date', dry: 'already up to date' })
  })
  it('pulls, and says when it switched branch', () => {
    expect(planPull(facts({ behind: 3 }))).toEqual({ action: 'pull', message: 'updated 3 commits', dry: 'would pull 3 commits' })
    expect(planPull(facts({ behind: 1 })).message).toBe('updated 1 commit')
    expect(planPull(facts({ current: 'feat/x', behind: 2 }))).toEqual({ action: 'pull', message: 'updated 2 commits (switched from feat/x)', dry: 'would switch feat/x to main and pull 2 commits' })
    expect(planPull(facts({ current: 'feat/x' }))).toEqual({ action: 'pull', message: 'already up to date (switched from feat/x)', dry: 'would switch feat/x to main (already up to date)' })
  })
})

describe('worktrees', () => {
  it('branch names git and the folder layout can take', () => {
    for (const ok of ['main', 'feat/PROJ-1-login', 'release-1.2', 'a_b', '1x']) expect(validBranchName(ok), ok).toBe(true)
    for (const bad of ['', '-x', '--force', '/abs', 'a..b', 'feat/', 'x.lock', 'has space', 'a:b', 'a~1', 'a^', 'a\\b', '.hidden']) expect(validBranchName(bad), bad).toBe(false)
  })
  it('one folder per repo and branch, slashes flattened', () => {
    expect(worktreeDir('base', 'my-api', 'feat/PROJ-1-login')).toBe(join('base', 'my-api', 'feat__PROJ-1-login'))
    expect(worktreeDir('base', 'my api', 'main')).toBe(join('base', 'my_api', 'main'))
  })
  it('reads git worktree list --porcelain', () => {
    const out = 'worktree C:/repos/api\r\nHEAD 1111111\r\nbranch refs/heads/main\r\n\r\nworktree C:/wt/api/feat__x\nHEAD 2222222\nbranch refs/heads/feat/x\n\nworktree C:/wt/api/detached\nHEAD 3333333\ndetached\n'
    expect(parseWorktrees(out)).toEqual([
      { path: 'C:/repos/api', branch: 'main', head: '1111111' },
      { path: 'C:/wt/api/feat__x', branch: 'feat/x', head: '2222222' },
      { path: 'C:/wt/api/detached', branch: null, head: '3333333' },
    ])
    expect(parseWorktrees('')).toEqual([])
  })
})
