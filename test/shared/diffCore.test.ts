import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildHunks, counts, gapBefore, splitRows, toolHunks } from '../../src/shared/diffCore'

const show = (hs: ReturnType<typeof buildHunks>) => hs.map((h) => ({ a: h.a, b: h.b, lines: h.lines.map((l) => `${l.t}${l.text}|${l.a ?? ''}|${l.b ?? ''}`) }))
const nums = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `line ${i + from}`)

test('buildHunks: one changed line in the middle, 3 lines of context, line numbers', () => {
  const old = nums(20).join('\n') + '\n'
  const neu = nums(20).map((l, i) => (i === 9 ? 'CHANGED' : l)).join('\n') + '\n'
  const hs = buildHunks(old, neu)
  assert.equal(hs.length, 1)
  assert.deepEqual(show(hs)[0], {
    a: 7, b: 7,
    lines: [' line 7|7|7', ' line 8|8|8', ' line 9|9|9', '-line 10|10|', '+CHANGED||10', ' line 11|11|11', ' line 12|12|12', ' line 13|13|13'],
  })
  assert.equal(gapBefore(hs, 0), 6)
  assert.deepEqual(counts(hs), { add: 1, del: 1 })
})

test('buildHunks: changes far apart are separate hunks, near ones merge', () => {
  const base = nums(40)
  const far = base.map((l, i) => (i === 2 || i === 30 ? l + '!' : l))
  const hs = buildHunks(base.join('\n'), far.join('\n'))
  assert.equal(hs.length, 2)
  assert.deepEqual([hs[0].a, hs[1].a], [1, 28])
  assert.equal(gapBefore(hs, 1), 28 - (1 + 6)) // first hunk covers old lines 1-6
  const near = base.map((l, i) => (i === 10 || i === 15 ? l + '!' : l))
  assert.equal(buildHunks(base.join('\n'), near.join('\n')).length, 1)
})

test('buildHunks: context Infinity is the whole text as one hunk; identical texts have no hunks', () => {
  const base = nums(30)
  const hs = buildHunks(base.join('\n'), base.map((l, i) => (i === 0 ? 'x' : l)).join('\n'), Infinity)
  assert.equal(hs.length, 1)
  assert.equal(hs[0].lines.length, 31)
  assert.deepEqual(buildHunks('a\nb\n', 'a\nb\n'), [])
  assert.deepEqual(buildHunks('', ''), [])
})

test('buildHunks: insertion only, deletion only, all new, all removed, CRLF', () => {
  assert.deepEqual(show(buildHunks('a\nc', 'a\nb\nc')), [{ a: 1, b: 1, lines: [' a|1|1', '+b||2', ' c|2|3'] }])
  assert.deepEqual(show(buildHunks('a\nb\nc', 'a\nc')), [{ a: 1, b: 1, lines: [' a|1|1', '-b|2|', ' c|3|2'] }])
  assert.deepEqual(show(buildHunks('', 'x\ny\n')), [{ a: 1, b: 1, lines: ['+x||1', '+y||2'] }])
  assert.deepEqual(show(buildHunks('x\ny', '')), [{ a: 1, b: 1, lines: ['-x|1|', '-y|2|'] }])
  assert.deepEqual(buildHunks('a\r\nb\r\n', 'a\nb\n'), [])
})

test('buildHunks: a hunk of pure additions after unchanged lines starts at the right old line', () => {
  const old = nums(10).join('\n')
  const neu = [...nums(10), 'new 1', 'new 2'].join('\n')
  const [h] = buildHunks(old, neu)
  assert.equal(h.a, 8) // context 8-10, then additions
  assert.equal(h.b, 8)
  const [h2] = buildHunks(old, neu, 0)
  assert.deepEqual([h2.a, h2.b], [11, 11]) // no old lines in it: where they would be
})

test('buildHunks: minimal edit with moved and repeated lines (LCS)', () => {
  const hs = buildHunks('a\nb\nc\nd\ne', 'a\nc\nb\nd\ne', Infinity)
  assert.deepEqual(counts(hs), { add: 1, del: 1 })
  const rows = splitRows(hs[0])
  assert.equal(rows.length, 6)
})

test('toolHunks: structuredPatch wins; Edit / MultiEdit / Write fall back to the input', () => {
  const patch = [{ oldStart: 40, oldLines: 1, newStart: 40, newLines: 1, lines: ['-old', '+new'] }]
  assert.equal(toolHunks('Edit', { old_string: 'x', new_string: 'y' }, patch)[0].a, 40)
  assert.deepEqual(counts(toolHunks('Edit', { old_string: 'a\nb\nc', new_string: 'a\nB\nc' })), { add: 1, del: 1 })
  assert.deepEqual(counts(toolHunks('MultiEdit', { edits: [{ old_string: 'x', new_string: 'y\nz' }, { old_string: 'p', new_string: '' }] })), { add: 2, del: 2 })
  const w = toolHunks('Write', { content: 'one\ntwo\nthree\n' })
  assert.deepEqual(counts(w), { add: 3, del: 0 })
  assert.equal(w[0].lines[2].b, 3)
  assert.deepEqual(toolHunks('Write', { content: '' }), [])
  assert.deepEqual(toolHunks('Edit', null), [])
  assert.deepEqual(toolHunks('Read', { file_path: 'x' }), [])
  assert.deepEqual(counts(toolHunks('Write', { content: 'a' }, [])), { add: 1, del: 0 }) // empty patch: fall back
})

test('buildHunks: big middles still give a correct (non-minimal) diff', () => {
  const a = Array.from({ length: 2500 }, (_, i) => `a${i}`).join('\n')
  const b = Array.from({ length: 2500 }, (_, i) => `b${i}`).join('\n')
  const hs = buildHunks(a, b)
  assert.deepEqual(counts(hs), { add: 2500, del: 2500 })
})
