// the phone's review and merge of a thread's branch: diffs cut to size, the merge method, every merge refusal
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { allowedGhWrite, autoMergeBlock, capDiff, mergeBlock, numstatFiles, parseMergeInfo, pickMergeMethod, reviewFeedback, runAutoMerge, runMerge, safeBranch, type MergeInfo, type MergePr } from '../../src/shared/prCore'
import { summarizeChecks } from '../../src/shared/ciCore'

const SHA = 'a'.repeat(40)
const pass = summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])
const pr = (o: Partial<MergePr & { method: 'squash' | 'merge' | 'rebase' | null }> = {}) => ({
  number: 7, url: 'u', title: 'T', state: 'OPEN', isDraft: false, headRefOid: SHA, baseRefName: 'main', mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN', checks: pass, checksText: '1 of 1 passed', method: 'squash' as const, ...o,
})

test('capDiff keeps a short diff whole and cuts a long one by lines or bytes, saying how many more', () => {
  assert.deepEqual(capDiff('a\nb\n'), { text: 'a\nb', totalLines: 2, shown: 2, truncated: false })
  const long = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
  const c = capDiff(long, 4)
  assert.equal(c.text, 'l0\nl1\nl2\nl3\n… truncated, 6 more lines')
  assert.deepEqual([c.totalLines, c.shown, c.truncated], [10, 4, true])
  const b = capDiff('xxxx\nyyyy\nzzzz', 100, 10) // 5 bytes a line with its newline
  assert.deepEqual([b.shown, b.text.split('\n').at(-1)], [2, '… truncated, 1 more lines'])
})

test('pickMergeMethod: the only one allowed, else squash, merge, rebase; null when none', () => {
  assert.equal(pickMergeMethod({ rebaseMergeAllowed: true }), 'rebase')
  assert.equal(pickMergeMethod({ mergeCommitAllowed: true }), 'merge')
  assert.equal(pickMergeMethod({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true }), 'squash')
  assert.equal(pickMergeMethod({ mergeCommitAllowed: true, rebaseMergeAllowed: true }), 'merge')
  assert.equal(pickMergeMethod({}), null)
})

test('mergeBlock allows only an open, ready, green, clean PR into the default branch at the head the phone saw', () => {
  assert.equal(mergeBlock(pr(), SHA, 'main'), null)
  assert.equal(mergeBlock(pr(), SHA.toUpperCase(), 'main'), null)
  const refused: [string, string | null][] = [
    ['no PR', mergeBlock(null, SHA, 'main')],
    ['closed', mergeBlock(pr({ state: 'CLOSED' }), SHA, 'main')],
    ['merged', mergeBlock(pr({ state: 'MERGED' }), SHA, 'main')],
    ['draft', mergeBlock(pr({ isDraft: true }), SHA, 'main')],
    ['no checks', mergeBlock(pr({ checks: summarizeChecks([]) }), SHA, 'main')],
    ['failing', mergeBlock(pr({ checks: summarizeChecks([{ status: 'COMPLETED', conclusion: 'FAILURE' }]) }), SHA, 'main')],
    ['pending', mergeBlock(pr({ checks: summarizeChecks([{ status: 'IN_PROGRESS' }]) }), SHA, 'main')],
    ['conflicting', mergeBlock(pr({ mergeable: 'CONFLICTING' }), SHA, 'main')],
    ...['BEHIND', 'BLOCKED', 'DIRTY', 'UNSTABLE', 'UNKNOWN', 'HAS_HOOKS', ''].map((s): [string, string | null] => [s || 'no state', mergeBlock(pr({ mergeStateStatus: s }), SHA, 'main')]),
    ['other head', mergeBlock(pr(), 'b'.repeat(40), 'main')],
    ['short sha', mergeBlock(pr(), SHA.slice(0, 7), 'main')],
    ['option as sha', mergeBlock(pr(), '--admin', 'main')],
    ['not the default base', mergeBlock(pr({ baseRefName: 'develop' }), SHA, 'main')],
    ['default unknown', mergeBlock(pr(), SHA, '')],
    ['release base', mergeBlock(pr({ baseRefName: 'release/1.2' }), SHA, 'main')],
    ['prod as default', mergeBlock(pr({ baseRefName: 'prod' }), SHA, 'prod')],
    ['production as default', mergeBlock(pr({ baseRefName: 'production' }), SHA, 'production')],
    ['no method', mergeBlock(pr({ method: null }), SHA, 'main')],
  ]
  for (const [name, why] of refused) assert.ok(typeof why === 'string' && why.length > 0, name)
  assert.match(mergeBlock(pr({ mergeStateStatus: 'BEHIND' }), SHA, 'main')!, /behind/)
  assert.match(mergeBlock(pr(), 'b'.repeat(40), 'main')!, /new commits/)
  assert.equal(mergeBlock(pr({ baseRefName: 'master' }), SHA, 'master'), null)
})

const ghPr = JSON.stringify({ number: 12, url: 'https://github.com/o/r/pull/12', title: 'Add x', state: 'OPEN', isDraft: false, headRefOid: SHA, baseRefName: 'main', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] })
const ghRepo = JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, defaultBranchRef: { name: 'main' }, nameWithOwner: 'o/r' })

test('parseMergeInfo reads gh pr view and gh repo view into the PR card and its verdict', () => {
  const i = parseMergeInfo(ghPr, ghRepo)
  assert.deepEqual([i.repo, i.defaultBranch, i.method, i.block, i.pr.number, i.pr.checksText], ['o/r', 'main', 'squash', null, 12, '1 of 1 passed'])
  assert.match(parseMergeInfo(ghPr.replace('"CLEAN"', '"BLOCKED"'), ghRepo).block!, /blocked/)
})

test('runMerge writes once, with the number and method from the live info and the shown head, and never when blocked', async () => {
  const calls: string[][] = []
  const write = async (a: string[]) => { calls.push(a) }
  const info: MergeInfo = parseMergeInfo(ghPr, ghRepo)
  assert.deepEqual(await runMerge(info, SHA, write), { ok: true, number: 12, method: 'squash' })
  assert.deepEqual(calls, [['pr', 'merge', '12', '--squash', '--match-head-commit', SHA]])
  for (const a of calls[0]) assert.ok(!['--delete-branch', '-d', '--admin', '--auto'].includes(a))
  calls.length = 0
  assert.equal((await runMerge(info, 'b'.repeat(40), write)).ok, false)
  assert.equal((await runMerge(null, SHA, write)).ok, false)
  assert.deepEqual(await runMerge({ unavailable: 'gh is signed out' }, SHA, write), { ok: false, reason: 'gh is signed out' })
  assert.equal((await runMerge({ ...info, pr: { ...info.pr, isDraft: true } }, SHA, write)).ok, false)
  assert.equal(calls.length, 0)
  // gh refusing (a race GitHub caught) is said, not thrown
  assert.deepEqual(await runMerge(info, SHA, async () => { throw new Error('Head branch was modified') }), { ok: false, reason: 'Head branch was modified' })
})

test('numstatFiles lists text and binary files with their counts', () => {
  assert.deepEqual(numstatFiles('3\t1\tsrc/a.ts\0-\t-\timg.png\0'), [
    { path: 'src/a.ts', add: 3, del: 1, binary: false },
    { path: 'img.png', add: 0, del: 0, binary: true },
  ])
})

test('autoMergeBlock: the merge rules except the checks and merge state; still no draft, closed, non-default or release base', () => {
  const failing = summarizeChecks([{ status: 'COMPLETED', conclusion: 'FAILURE' }])
  assert.equal(autoMergeBlock(pr({ checks: failing, mergeStateStatus: 'BLOCKED' }), SHA, 'main'), null)
  assert.equal(autoMergeBlock(pr({ checks: summarizeChecks([]) }), SHA, 'main'), null)
  assert.match(autoMergeBlock(pr({ isDraft: true }), SHA, 'main')!, /draft/)
  assert.match(autoMergeBlock(pr({ state: 'CLOSED' }), SHA, 'main')!, /closed/)
  assert.match(autoMergeBlock(pr({ baseRefName: 'dev' }), SHA, 'main')!, /not the default/)
  assert.match(autoMergeBlock(pr({ baseRefName: 'prod' }), SHA, 'prod')!, /release branch/)
  assert.match(autoMergeBlock(pr(), 'b'.repeat(40), 'main')!, /new commits/)
  assert.match(autoMergeBlock(pr({ mergeable: 'CONFLICTING' }), SHA, 'main')!, /conflicts/)
  assert.match(autoMergeBlock(pr({ method: null }), SHA, 'main')!, /no merge method/)
  assert.equal(autoMergeBlock(null, SHA, 'main'), 'This branch has no pull request.')
})

test('parseMergeInfo also reads the failing check names, auto-merge and the auto-merge verdict', () => {
  const j = JSON.parse(ghPr)
  const i = parseMergeInfo(JSON.stringify({ ...j, autoMergeRequest: { mergeMethod: 'SQUASH' }, statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }, { context: 'ci/lint', state: 'ERROR' }] }), ghRepo)
  assert.deepEqual([i.pr.failing, i.pr.autoMerge, i.autoBlock], [['test', 'ci/lint'], true, null])
  assert.match(i.block!, /failing/)
  assert.equal(parseMergeInfo(ghPr, ghRepo).pr.autoMerge, false)
})

test('reviewFeedback keeps comments from trusted people and apps other than the PR author, oldest first', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString()
  const f = reviewFeedback({
    author: { login: 'me' },
    comments: [
      { author: { login: 'me' }, authorAssociation: 'OWNER', createdAt: at(1) },
      { author: { login: 'stranger' }, authorAssociation: 'NONE', createdAt: at(2) },
      { author: { login: 'kyle' }, authorAssociation: 'MEMBER', createdAt: at(5) },
      { author: { login: 'codecov[bot]' }, authorAssociation: 'NONE', createdAt: at(3) },
    ],
    reviews: [
      { author: { login: 'dan' }, authorAssociation: 'COLLABORATOR', state: 'APPROVED', body: '', submittedAt: at(4) },
      { author: { login: 'dan' }, authorAssociation: 'COLLABORATOR', state: 'CHANGES_REQUESTED', body: 'fix', submittedAt: at(6) },
    ],
  })
  assert.deepEqual(f.map((x) => x.author), ['codecov[bot]', 'kyle', 'dan'])
  assert.deepEqual(reviewFeedback({}), [])
})

test('runAutoMerge turns auto-merge on with the live number, method and shown head, or off; never when blocked', async () => {
  const calls: string[][] = []
  const write = async (a: string[]) => { calls.push(a) }
  const info: MergeInfo = parseMergeInfo(ghPr, ghRepo)
  assert.deepEqual(await runAutoMerge(info, SHA, true, write), { ok: true, number: 12, method: 'squash' })
  assert.deepEqual(await runAutoMerge(info, SHA, false, write), { ok: true, number: 12, method: 'squash' })
  assert.deepEqual(calls, [['pr', 'merge', '12', '--auto', '--squash', '--match-head-commit', SHA], ['pr', 'merge', '12', '--disable-auto']])
  calls.length = 0
  assert.equal((await runAutoMerge(info, 'b'.repeat(40), true, write)).ok, false)
  assert.equal((await runAutoMerge({ ...info, pr: { ...info.pr, isDraft: true } }, SHA, true, write)).ok, false)
  assert.equal((await runAutoMerge({ ...info, pr: { ...info.pr, state: 'MERGED' } }, SHA, false, write)).ok, false)
  assert.equal((await runAutoMerge(null, SHA, true, write)).ok, false)
  assert.deepEqual(await runAutoMerge({ unavailable: 'no gh' }, SHA, true, write), { ok: false, reason: 'no gh' })
  assert.equal(calls.length, 0)
  assert.deepEqual(await runAutoMerge(info, SHA, true, async () => { throw new Error('auto-merge is not allowed') }), { ok: false, reason: 'auto-merge is not allowed' })
})

test('allowedGhWrite allows exactly a merge, the same with --auto, and --disable-auto', () => {
  assert.ok(allowedGhWrite(['pr', 'merge', '12', '--squash', '--match-head-commit', SHA]))
  assert.ok(allowedGhWrite(['pr', 'merge', '12', '--auto', '--rebase', '--match-head-commit', SHA]))
  assert.ok(allowedGhWrite(['pr', 'merge', '12', '--disable-auto']))
  for (const a of [
    ['pr', 'merge', '12', '--squash', '--match-head-commit', SHA, '--delete-branch'],
    ['pr', 'merge', '12', '--squash', '--admin', SHA],
    ['pr', 'merge', '12', '--auto', '--squash'],
    ['pr', 'merge', '12', '--auto', '--squash', '--match-head-commit', 'main'],
    ['pr', 'merge', '-1', '--disable-auto'],
    ['pr', 'merge', '12', '--disable-auto', '--delete-branch'],
    ['pr', 'close', '12'],
    ['api', '-X', 'PUT', 'repos/o/r/pulls/12/merge'],
    [],
  ]) assert.equal(allowedGhWrite(a), false, a.join(' '))
})

test('safeBranch takes plain branch names only', () => {
  assert.ok(safeBranch('main') && safeBranch('release/1.2'))
  assert.ok(!safeBranch('-x') && !safeBranch('a..b') && !safeBranch('a b') && !safeBranch(''))
})
