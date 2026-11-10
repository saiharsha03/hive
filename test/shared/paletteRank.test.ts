import { test } from 'vitest'
import assert from 'node:assert/strict'
import { fileRank, matchRank } from '../../src/shared/paletteRank'

test('starts-with beats word-start beats anywhere, and no match is null', () => {
  assert.equal(matchRank('New thread', 'new'), 0)
  assert.equal(matchRank('Open new thread', 'new'), 1)
  assert.equal(matchRank('Renewal', 'new'), 2)
  assert.equal(matchRank('Settings', 'zzz'), null)
  assert.equal(matchRank('Settings', ' '), 0) // nothing typed keeps everything
  assert.equal(matchRank('my-file_name.ts', 'name'), 1)
})

test('a file ranks by its name first, then its path', () => {
  assert.equal(fileRank('src/App.tsx', 'app'), 0)
  assert.equal(fileRank('src/main/index.ts', 'index'), 0)
  assert.equal(fileRank('src/main/index.ts', 'main'), 2)
  assert.equal(fileRank('src\\main\\files.ts', 'main'), 2)
  assert.equal(fileRank('src/main/index.ts', 'nope'), null)
})
