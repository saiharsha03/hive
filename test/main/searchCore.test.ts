import { test } from 'vitest'
import assert from 'node:assert/strict'
import { reuseVectors } from '../../src/main/searchCore'

test('a grown transcript embeds only its new chunks and keeps the old vectors in place', async () => {
  const fake = (ts: string[]) => Float32Array.from(ts.flatMap((t) => [t.length, 1]))
  const asked: string[][] = []
  const embed = async (ts: string[]) => { asked.push(ts); return fake(ts) }
  const old = ['a', 'bb']
  const vecs = await reuseVectors(['a', 'bb', 'ccc'], old, Float32Array.from([9, 9, 8, 8]), 2, embed)
  assert.deepEqual(asked, [['ccc']])
  assert.deepEqual([...vecs!], [9, 9, 8, 8, 3, 1])
  // no old vectors (never embedded): everything is embedded; a failed embed is null
  assert.deepEqual([...(await reuseVectors(['a'], old, null, 2, embed))!], [1, 1])
  assert.equal(await reuseVectors(['x'], [], null, 2, async () => null), null)
})
