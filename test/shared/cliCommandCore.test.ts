import { test } from 'vitest'
import assert from 'node:assert/strict'
import { cliLine, cliOnlyCommand } from '../../src/shared/cliCommandCore'

test('a command only the interactive CLI runs is picked out, and nothing else can reach the shell line', () => {
  assert.equal(cliOnlyCommand("<local-command-stdout>/design-login isn't available in this environment.</local-command-stdout>"), '/design-login')
  assert.equal(cliOnlyCommand("/plugin:install isn't available in this environment."), '/plugin:install')
  assert.equal(cliOnlyCommand('/cost: $1.20'), null)
  assert.equal(cliOnlyCommand("/x; rm -rf ~ isn't available in this environment"), null) // not a plain /name right before it
  assert.equal(cliLine('/design-login'), 'claude "/design-login"')
})
