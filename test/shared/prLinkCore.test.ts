// pull request references in Claude's replies become links; the thread's own PRs come from gh pr create's output
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { linkPrTree, prPieces, threadPrs } from '../../src/shared/prLinkCore'

const links = (text: string, repo?: string) => prPieces(text, repo).filter((p) => typeof p !== 'string')

test('owner/repo#N and owner/repo #N both link, punctuation after the number stays text', () => {
  assert.deepEqual(prPieces('The PR is open and ready for review: acme/etl-jobs #90.'), [
    'The PR is open and ready for review: ',
    { text: 'acme/etl-jobs #90', url: 'https://github.com/acme/etl-jobs/issues/90' },
    '.',
  ])
  assert.deepEqual(prPieces('(see a/b#7), done'), ['(see ', { text: 'a/b#7', url: 'https://github.com/a/b/issues/7' }, '), done'])
  assert.equal(links('a/b#7: and c/d.e #8!').length, 2)
})

test('no match inside a longer word, a file path or another URL', () => {
  assert.deepEqual(links('xa/b#12a and src/main/chat.ts#L12 and C:\\x\\y#3 and ./a/b#4'), [])
  assert.deepEqual(links('https://example.com/a/b#12 and PR#5'), [])
})

test('a github pull or issue URL links once, its tail and trailing punctuation stay text', () => {
  assert.deepEqual(prPieces('at https://github.com/o/r/pull/12.'), ['at ', { text: 'https://github.com/o/r/pull/12', url: 'https://github.com/o/r/pull/12' }, '.'])
  assert.equal(links('https://github.com/o/r/pull/12/files#diff-1').length, 1)
})

test('a bare #N links only when the thread repo is known', () => {
  assert.deepEqual(links('fixed in #42'), [])
  assert.deepEqual(links('fixed in #42, and &#43;', 'o/r'), [{ text: '#42', url: 'https://github.com/o/r/issues/42' }])
})

test('a common word pair before a spaced #N is not a repo; only its #N links once the repo is known', () => {
  assert.deepEqual(links('use this and/or #5, yes/no #6, N/A #7'), [])
  assert.deepEqual(prPieces('fix and/or #5.', 'o/r'), ['fix and/or ', { text: '#5', url: 'https://github.com/o/r/issues/5' }, '.'])
  // the unspaced form is still a repo reference
  assert.equal(links('on/off#3').length, 1)
})

test('in markdown: code spans, code blocks and existing links are left alone', () => {
  const tree = fromMarkdown('See o/r#1 and `o/r#2` and [o/r#3](https://x.test) and https://github.com/o/r/pull/4\n\n```\no/r#5\n```\n', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  linkPrTree(tree as never)
  const urls: string[] = []
  const walk = (n: { type: string; url?: string; children?: never[] }) => { if (n.type === 'link') urls.push(n.url!); n.children?.forEach(walk) }
  walk(tree as never)
  assert.deepEqual(urls, ['https://github.com/o/r/issues/1', 'https://x.test', 'https://github.com/o/r/pull/4'])
})

test('the PRs a thread opened, from the output of a gh pr create that succeeded', () => {
  const pr = (id: string, output: string, status = 'done') => ({ kind: 'tool', id, name: 'Bash', input: { command: 'gh pr create --fill' }, status, output })
  assert.deepEqual(threadPrs([
    pr('1', 'https://github.com/o/r/pull/3\n'),
    { kind: 'tool', name: 'Bash', input: { command: 'gh pr view 9' }, status: 'done', output: 'https://github.com/o/r/pull/9' },
    pr('2', 'failed', 'error'),
    pr('3', 'Creating pull request\nhttps://github.com/acme/etl-jobs/pull/90'),
  ]), [
    { repo: 'o/r', num: 3, url: 'https://github.com/o/r/pull/3' },
    { repo: 'acme/etl-jobs', num: 90, url: 'https://github.com/acme/etl-jobs/pull/90' },
  ])
  assert.deepEqual(threadPrs([]), [])
})
