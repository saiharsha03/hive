import { test } from 'vitest'
import assert from 'node:assert/strict'
import { runFailed } from '../../src/shared/allowCore'

test('allowlist run fails on a non-zero exit or a printed failure, even with exit 0', () => {
  assert.equal(runFailed(0, 'Successfully updated security group sg-1 with IP 1.2.3.4/32 on port 5432 for postgres.'), false)
  assert.equal(runFailed(0, 'Rule with IP 1.2.3.4/32 and port 5432 already exists in security group sg-1. Skipping.'), false)
  assert.equal(runFailed(0, 'Failed to update security group sg-1: An error occurred (UnauthorizedOperation)'), true)
  assert.equal(runFailed(0, 'Traceback (most recent call last):\n  File "x.py"'), true)
  assert.equal(runFailed(1, 'No matching security groups found.'), true)
  assert.equal(runFailed(null, ''), true)
})
