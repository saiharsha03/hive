import { test } from 'vitest'
import assert from 'node:assert/strict'
import { isNewer } from '../../src/shared/versionCore'

test('isNewer compares releases part by part', () => {
  assert.equal(isNewer('v2.0.0', '1.2.0'), true)
  assert.equal(isNewer('1.10.0', '1.9.3'), true)
  assert.equal(isNewer('2.0', '2.0.0'), false)
  assert.equal(isNewer('v1.2.0', '1.2.0'), false)
  assert.equal(isNewer('1.1.9', '1.2.0'), false)
  assert.equal(isNewer('2.0.0-beta', '2.0.0'), false)
})
