import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildDecorations, lookup } from '../../src/shared/fileDecoCore'

const z = (...recs: string[]) => recs.join('\0') + '\0'
const ch = (xy: string, p: string) => `1 ${xy} N... 100644 100644 100644 aaa bbb ${p}`
const root = String.raw`C:\ws`

test('strongest change wins on the folder and every parent', () => {
  const d = buildDecorations(root, [{ top: 'C:/ws/repo', z: z('? src/a/new.ts', ch('.M', 'src/a/b.ts'), ch('D.', 'src/gone.ts'), ch('A.', 'lib/x.ts')) }])
  assert.equal(lookup(d, String.raw`C:\ws\repo\src\a`, true)?.kind, 'modified') // untracked + modified -> modified
  assert.equal(lookup(d, String.raw`C:\ws\repo\src`, true)?.kind, 'deleted')    // + deleted -> deleted
  assert.equal(lookup(d, String.raw`C:\ws\repo\lib`, true)?.kind, 'added')
  assert.equal(lookup(d, String.raw`C:\ws\repo`, true)?.kind, 'deleted')
  assert.equal(lookup(d, String.raw`C:\ws`, true)?.kind, 'deleted')
})
test('order does not matter: a weaker change after a stronger one keeps the stronger', () => {
  const d = buildDecorations(root, [{ top: 'C:/ws/r', z: z(ch('.M', 'a/m.ts'), '? a/u.ts', ch('R. N... 100644 100644 aaa bbb R100', 'x')) }])
  assert.equal(lookup(d, 'C:/ws/r/a', true)?.kind, 'modified')
})
test('a conflict beats everything', () => {
  const d = buildDecorations(root, [{ top: 'C:/ws/r', z: z(ch('D.', 'a/d.ts'), 'u UU N... 100644 100644 100644 100644 a b c a/c.ts') }])
  assert.equal(lookup(d, 'C:/ws/r/a', true)?.kind, 'conflict')
  assert.deepEqual(lookup(d, 'C:/ws/r/a/c.ts', false), { kind: 'conflict', letter: '!' })
})
test('file letters', () => {
  const d = buildDecorations(root, [{ top: 'C:/ws/r', z: z(ch('.M', 'm'), ch('A.', 'a'), ch('.D', 'd'), '? u', '2 R. N... 100644 100644 100644 aaa bbb R100 new\0old') }])
  assert.deepEqual(['m', 'a', 'd', 'u', 'new'].map((f) => lookup(d, `C:/ws/r/${f}`, false)?.letter), ['M', 'A', 'D', 'U', 'R'])
})
test('ignored is dimmed, inherited, and never rolls up', () => {
  const d = buildDecorations(root, [{ top: 'C:/ws/r', z: z('! node_modules/', '! out/x.log') }])
  assert.equal(lookup(d, 'C:/ws/r/node_modules', true)?.kind, 'ignored')
  assert.equal(lookup(d, 'C:/ws/r/node_modules/react/index.js', false)?.kind, 'ignored')
  assert.equal(lookup(d, 'C:/ws/r/out/x.log', false)?.kind, 'ignored')
  assert.equal(lookup(d, 'C:/ws/r/out', true), undefined)
  assert.equal(lookup(d, 'C:/ws/r', true), undefined)
})
test('untracked folder: green itself, its files U, its subfolders green without a letter', () => {
  const d = buildDecorations(root, [{ top: 'C:/ws/r', z: z('? newdir/') }])
  assert.equal(lookup(d, 'C:/ws/r/newdir', true)?.kind, 'untracked')
  assert.deepEqual(lookup(d, 'C:/ws/r/newdir/deep/f.ts', false), { kind: 'untracked', letter: 'U' })
  assert.deepEqual(lookup(d, 'C:/ws/r/newdir/deep', true), { kind: 'untracked', letter: '' })
})
test('separate repos under the workspace each roll up on their own, stopping at the browsed root', () => {
  const d = buildDecorations('C:/ws/agents', [{ top: 'C:/ws/agents/alpha', z: z('? a.py') }, { top: 'C:/ws/agents/beta', z: z(ch('.M', 'b.py')) }])
  assert.equal(lookup(d, 'C:/ws/agents/alpha', true)?.kind, 'untracked')
  assert.equal(lookup(d, 'C:/ws/agents/beta', true)?.kind, 'modified')
  assert.equal(lookup(d, 'C:/ws/agents', true)?.kind, 'modified')
  assert.equal(lookup(d, 'C:/ws', true), undefined)
})
test('Windows paths are case- and slash-insensitive', () => {
  const d = buildDecorations(root, [{ top: 'C:/WS/r', z: z(ch('.M', 'Src/A.ts')) }])
  assert.equal(lookup(d, String.raw`c:\ws\R\src\a.TS`, false)?.letter, 'M')
})
