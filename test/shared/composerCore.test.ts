import { test } from 'vitest'
import assert from 'node:assert/strict'
import { filterCommands, hasUltrathink, insertCommand, slashQuery, ultrathinkParts, type Command } from '../../src/shared/composerCore'

const cmds: Command[] = [
  { name: 'review', description: 'Review a pull request', builtin: true },
  { name: 'greptile:review', description: 'Review the current branch with Greptile' },
  { name: 'pr-review', description: 'Review one or more GitHub PRs' },
  { name: 'compact', description: 'Clear history but keep a summary', builtin: true },
  { name: 'usage', description: 'Show plan usage limits', aliases: ['cost', 'stats'], builtin: true },
  { name: 'csv-import', description: 'import a spreadsheet' },
]

test('slash: when the menu opens', () => {
  assert.equal(slashQuery('/'), '')
  assert.equal(slashQuery('/rev'), 'rev')
  assert.equal(slashQuery('/greptile:re'), 'greptile:re')
  assert.equal(slashQuery('/goal clear'), null)
  assert.equal(slashQuery('hi /x'), null)
  assert.equal(slashQuery(''), null)
  assert.equal(slashQuery('/x\n'), null)
})
test('slash: filtering and order', () => {
  assert.deepEqual(filterCommands(cmds, '').map((c) => c.name), ['compact', 'review', 'usage', 'csv-import', 'greptile:review', 'pr-review'])
  assert.deepEqual(filterCommands(cmds, 'rev').map((c) => c.name), ['review', 'greptile:review', 'pr-review'])
  assert.deepEqual(filterCommands(cmds, 'greptile').map((c) => c.name), ['greptile:review'])
  assert.deepEqual(filterCommands(cmds, 'cost').map((c) => c.name), ['usage']) // alias
  assert.deepEqual(filterCommands(cmds, 'IMPORT').map((c) => c.name), ['csv-import'])
  assert.deepEqual(filterCommands(cmds, 'github').map((c) => c.name), ['pr-review']) // description
  assert.deepEqual(filterCommands(cmds, 'zzz'), [])
  assert.equal(insertCommand(cmds[1]), '/greptile:review ')
})
test('ultrathink: detection and highlight pieces', () => {
  assert.ok(hasUltrathink('please UltraThink about this'))
  assert.ok(hasUltrathink('ultrathink: what is 17*23?'))
  assert.ok(!hasUltrathink('ultrathinking'))
  assert.ok(!hasUltrathink('think hard'))
  assert.deepEqual(ultrathinkParts('a ultrathink b Ultrathink'), [
    { text: 'a ', hit: false }, { text: 'ultrathink', hit: true }, { text: ' b ', hit: false }, { text: 'Ultrathink', hit: true },
  ])
  assert.deepEqual(ultrathinkParts('plain'), [{ text: 'plain', hit: false }])
})
