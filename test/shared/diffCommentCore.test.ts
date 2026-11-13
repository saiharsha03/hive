import { test } from 'vitest'
import assert from 'node:assert/strict'
import { commentAt, diffCommentsMessage } from '../../src/shared/diffCommentCore'

test('a comment is on the new line number, a removed line on its old one', () => {
  assert.deepEqual(commentAt('src/a.ts', { t: '+', text: 'const x = 1', a: null, b: 12 }, ' rename x '), { file: 'src/a.ts', line: 12, side: 'new', text: 'const x = 1', comment: 'rename x' })
  assert.deepEqual(commentAt('src/a.ts', { t: '-', text: 'old()', a: 7, b: null }, 'why gone?'), { file: 'src/a.ts', line: 7, side: 'old', text: 'old()', comment: 'why gone?' })
  assert.equal(commentAt('src/a.ts', { t: ' ', text: 'x', a: 3, b: 3 }, '   '), null)
})

test('the comments go as one message, each quoting file:line and the line', () => {
  const msg = diffCommentsMessage([
    { file: 'src/a.ts', line: 12, side: 'new', text: 'const x = 1', comment: 'rename x' },
    { file: 'src/b.ts', line: 7, side: 'old', text: 'old()', comment: 'keep this call' },
  ])
  assert.equal(msg, [
    'Comments on the diff (2):',
    'src/a.ts:12\n> const x = 1\nrename x',
    'src/b.ts:7 (removed line)\n> old()\nkeep this call',
  ].join('\n\n'))
  assert.equal(diffCommentsMessage([]), '')
})
