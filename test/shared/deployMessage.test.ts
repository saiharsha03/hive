import { test } from 'vitest'
import assert from 'node:assert/strict'
import { deployMessage } from '../../src/shared/deployMessage'

test('the message is what the script prints above its closing rule', () => {
  const out = 'Deploying the ledger suite shortly.\nChangelogs:\nledger-api: https://example.test/compare/a...b\n-----\nThe above message will be copied to clipboard.\n'
  assert.equal(deployMessage(out), 'Deploying the ledger suite shortly.\nChangelogs:\nledger-api: https://example.test/compare/a...b')
})

test('output without the rule is the message as it is', () => {
  assert.equal(deployMessage('one\r\ntwo\n'), 'one\ntwo')
})
