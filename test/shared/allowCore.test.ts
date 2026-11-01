import { test } from 'vitest'
import assert from 'node:assert/strict'
import { runFailed } from '../../src/shared/allowCore'

const denied = 'Failed to update security group sg-2: An error occurred (UnauthorizedOperation) when calling the AuthorizeSecurityGroupIngress operation: You are not authorized to perform this operation.'

test('allowlist run fails on a non-zero exit or a printed failure, even with exit 0', () => {
  assert.equal(runFailed(0, 'Successfully updated security group sg-1 with IP 1.2.3.4/32 on port 5432 for postgres.'), false)
  assert.equal(runFailed(0, 'Rule with IP 1.2.3.4/32 and port 5432 already exists in security group sg-1. Skipping.'), false)
  assert.equal(runFailed(0, 'Failed to update security group sg-1: An error occurred (InvalidGroup.NotFound)'), true)
  assert.equal(runFailed(0, 'Traceback (most recent call last):\n  File "x.py"'), true)
  assert.equal(runFailed(1, 'No matching security groups found.'), true)
  assert.equal(runFailed(null, ''), true)
})

test('groups the account may not change are skipped, unless no group took the IP', () => {
  assert.equal(runFailed(0, `Rule with IP 1.2.3.4/32 and port 5432 already exists in security group sg-1. Skipping.\n${denied}`), false)
  assert.equal(runFailed(0, denied), true)
})
