// realDir / sameDir: one folder spelled two ways compares equal; a path that does not exist keeps its tail.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { realDir, sameDir } from '../../src/main/paths'
import { tempDir } from '../support/tools'

test('a link to a folder is the same folder; missing paths resolve through their parent', () => {
  const t = tempDir('paths')
  const real = join(t.dir, 'real')
  mkdirSync(join(real, 'sub'), { recursive: true })
  const link = join(t.dir, 'link')
  symlinkSync(real, link, 'junction')
  assert.ok(sameDir(join(link, 'sub'), join(real, 'sub')))
  assert.equal(realDir(join(link, 'not-yet', 'f.txt')), join(real, 'not-yet', 'f.txt'))
  assert.ok(!sameDir(join(real, 'sub'), real))
  t.cleanup()
})
