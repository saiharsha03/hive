import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  detailOf, parseBranches, parseLog, parseNumstat, parseStatus, parseUnifiedDiff, pushArgs, relativeTime, safePath, safeSha,
} from '../../src/shared/gitCore'
import { counts, fromPatch, gapBefore, hunkFrom, splitRows } from '../../src/shared/diffCore'

const Z = (...r: string[]) => r.join('\0') + '\0'

test('parseStatus: branch headers, ordinary, rename, unmerged, untracked, spaces in paths', () => {
  const s = parseStatus(Z(
    '# branch.oid 1234567890abcdef',
    '# branch.head feat/x',
    '# branch.upstream origin/feat/x',
    '# branch.ab +2 -3',
    '1 M. N... 100644 100644 100644 aaa bbb src/a.ts',
    '1 .M N... 100644 100644 100644 aaa bbb dir with space/b c.ts',
    '1 MM N... 100644 100644 100644 aaa bbb both.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts', 'old name.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
    '? untracked file.txt',
  ))
  assert.equal(s.branch, 'feat/x')
  assert.equal(s.head, '1234567890abcdef')
  assert.equal(s.upstream, 'origin/feat/x')
  assert.equal(s.ahead, 2)
  assert.equal(s.behind, 3)
  assert.equal(s.files.length, 6)
  assert.deepEqual(s.files[1], { path: 'dir with space/b c.ts', x: '.', y: 'M', kind: 'changed' })
  assert.deepEqual(s.files[3], { path: 'new name.ts', orig: 'old name.ts', x: 'R', y: '.', kind: 'changed' })
  assert.equal(s.files[4].kind, 'unmerged')
  assert.deepEqual(s.files[5], { path: 'untracked file.txt', x: '?', y: '?', kind: 'untracked' })
})

test('parseStatus: initial commit, detached, no upstream', () => {
  const s = parseStatus(Z('# branch.oid (initial)', '# branch.head main'))
  assert.equal(s.head, null)
  assert.equal(s.branch, 'main')
  assert.equal(s.upstream, null)
  assert.equal(parseStatus(Z('# branch.oid abc', '# branch.head (detached)')).branch, null)
})

test('parseNumstat: counts, binary, rename', () => {
  const m = parseNumstat('3\t1\tsrc/a.ts\0-\t-\timg.png\0' + '5\t0\t\0old.ts\0new.ts\0')
  assert.deepEqual(m.get('src/a.ts'), { add: 3, del: 1, binary: false })
  assert.deepEqual(m.get('img.png'), { add: 0, del: 0, binary: true })
  assert.deepEqual(m.get('new.ts'), { add: 5, del: 0, binary: false })
  assert.equal(m.has('old.ts'), false)
})

test('detailOf: groups staged / unstaged / untracked with letters and counts', () => {
  const d = detailOf(Z(
    '# branch.oid abc', '# branch.head main',
    '1 MM N... 100644 100644 100644 aaa bbb both.ts',
    '1 A. N... 000000 100644 100644 000 bbb added.ts',
    '1 .D N... 100644 100644 000000 aaa bbb gone.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R90 new.ts', 'old.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
    '? notes.txt',
  ), '1\t1\tboth.ts\0' + '4\t0\tadded.ts\0' + '2\t1\t\0old.ts\0new.ts\0', '2\t0\tboth.ts\0' + '0\t9\tgone.ts\0')
  assert.deepEqual(d.staged.map((e) => `${e.letter} ${e.path}`), ['M both.ts', 'A added.ts', 'R new.ts'])
  assert.deepEqual(d.unstaged.map((e) => `${e.letter} ${e.path}`), ['M both.ts', 'D gone.ts', 'U conflict.ts'])
  assert.deepEqual(d.untracked, [{ path: 'notes.txt', letter: '?' }])
  assert.equal(d.staged[2].orig, 'old.ts')
  assert.equal(d.staged[2].add, 2)
  assert.equal(d.unstaged[1].del, 9)
  assert.equal(d.unstaged[0].add, 2)
})

test('parseLog + relativeTime', () => {
  const out = 'aaaa1111\x1faaaa111\x1fAda\x1f1700000000\x1fFirst: with \x1f odd title\x1e\nbbbb\x1fbbb\x1fBo\x1f1700000100\x1fSecond\x1e\n'
  const l = parseLog(out)
  assert.equal(l.length, 2)
  assert.deepEqual(l[0], { sha: 'aaaa1111', short: 'aaaa111', author: 'Ada', at: 1700000000, title: 'First: with \x1f odd title' })
  assert.equal(l[1].title, 'Second')
  const now = 1700000000 * 1000
  assert.equal(relativeTime(1700000000, now + 5_000), 'just now')
  assert.equal(relativeTime(1700000000, now + 60_000), '1 minute ago')
  assert.equal(relativeTime(1700000000, now + 3 * 3600_000), '3 hours ago')
  assert.equal(relativeTime(1700000000, now + 2 * 86400_000), '2 days ago')
  assert.equal(relativeTime(1700000000, now + 400 * 86400_000), '1 year ago')
})

test('parseBranches, pushArgs, safePath, safeSha', () => {
  assert.deepEqual(parseBranches('main\r\nfeat/x\n\n'), ['main', 'feat/x'])
  assert.deepEqual(pushArgs({ branch: 'feat/x', upstream: 'origin/feat/x' }), ['push'])
  assert.deepEqual(pushArgs({ branch: 'feat/x', upstream: null }), ['push', '-u', 'origin', 'feat/x'])
  assert.throws(() => pushArgs({ branch: null, upstream: null }), /detached/)
  assert.ok(safePath('src/a b.ts'))
  for (const bad of ['', '-rf', '../x', 'a/../../b', 'C:\\x', '/etc/passwd', '\\\\host\\s']) assert.equal(safePath(bad), false, bad)
  assert.ok(safeSha('abc1234'))
  assert.equal(safeSha('HEAD'), false)
  assert.equal(safeSha('--all'), false)
})

test('parseUnifiedDiff: modified, new, deleted, rename, binary, no-newline marker, multiple hunks', () => {
  const text = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,3 @@ function x',
    ' one',
    '-two',
    '+TWO',
    ' three',
    '@@ -10,2 +10,3 @@',
    ' ten',
    '+ten and a half',
    ' eleven',
    '\\ No newline at end of file',
    'diff --git a/new file.txt b/new file.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new file.txt\t',
    '@@ -0,0 +1,2 @@',
    '+a',
    '+b',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    'diff --git a/old.ts b/new.ts',
    'similarity index 100%',
    'rename from old.ts',
    'rename to new.ts',
    'diff --git a/img.png b/img.png',
    'Binary files a/img.png and b/img.png differ',
    '',
  ].join('\n')
  const f = parseUnifiedDiff(text)
  assert.deepEqual(f.map((x) => x.path), ['src/a.ts', 'new file.txt', 'gone.ts', 'new.ts', 'img.png'])
  assert.equal(f[0].hunks.length, 2)
  assert.deepEqual(f[0].hunks[0].lines.map((l) => [l.t, l.text, l.a, l.b]), [[' ', 'one', 1, 1], ['-', 'two', 2, null], ['+', 'TWO', null, 2], [' ', 'three', 3, 3]])
  assert.deepEqual(f[0].hunks[1].lines.map((l) => [l.t, l.a, l.b]), [[' ', 10, 10], ['+', null, 11], [' ', 11, 12]])
  assert.deepEqual(counts(f[0].hunks), { add: 2, del: 1 })
  assert.equal(f[1].oldPath, undefined)
  assert.deepEqual(f[1].hunks[0].lines.map((l) => [l.t, l.text, l.b]), [['+', 'a', 1], ['+', 'b', 2]])
  assert.deepEqual(counts(f[2].hunks), { add: 0, del: 1 })
  assert.equal(f[2].path, 'gone.ts')
  assert.equal(f[3].oldPath, 'old.ts')
  assert.equal(f[3].hunks.length, 0)
  assert.equal(f[4].binary, true)
})

test('parseUnifiedDiff: CRLF content keeps text without \\r', () => {
  const f = parseUnifiedDiff('diff --git a/w.txt b/w.txt\r\n--- a/w.txt\r\n+++ b/w.txt\r\n@@ -1 +1 @@\r\n-x\r\n+y\r\n')
  assert.deepEqual(f[0].hunks[0].lines.map((l) => l.text), ['x', 'y'])
})

test('splitRows pairs removed with added runs, context on both sides', () => {
  const h = hunkFrom(5, 5, [' a', '-b', '-c', '+B', ' d', '+e'])
  const rows = splitRows(h).map((r) => [r.l ? `${r.l.t}${r.l.text}${r.l.a}` : null, r.r ? `${r.r.t}${r.r.text}${r.r.b}` : null])
  assert.deepEqual(rows, [[' a5', ' a5'], ['-b6', '+B6'], ['-c7', null], [' d8', ' d7'], [null, '+e8']])
})

test('gapBefore counts unchanged lines hidden above and between hunks', () => {
  const hs = [hunkFrom(4, 4, [' a', '-b', '+c', ' d']), hunkFrom(20, 20, [' x', '+y'])]
  assert.equal(gapBefore(hs, 0), 3) // lines 1-3
  assert.equal(gapBefore(hs, 1), 13) // old lines 7-19
  assert.equal(gapBefore([hunkFrom(1, 1, ['+a'])], 0), 0)
})

test('fromPatch reads structuredPatch; bad input is null', () => {
  const h = fromPatch([{ oldStart: 2, oldLines: 2, newStart: 2, newLines: 3, lines: [' k', '-o', '+n', '+m'] }])!
  assert.deepEqual(h[0].lines.map((l) => [l.t, l.a, l.b]), [[' ', 2, 2], ['-', 3, null], ['+', null, 3], ['+', null, 4]])
  assert.equal(fromPatch([]), null)
  assert.equal(fromPatch(undefined), null)
  assert.equal(fromPatch([{ oldStart: 1 }]), null)
  assert.equal(fromPatch([{ oldStart: 0, newStart: 0, lines: ['+a'] }])![0].b, 1)
})
