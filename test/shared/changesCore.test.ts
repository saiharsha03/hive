// the Git tab's thread list: once the thread opens a pull request, the edits that went into it drop out
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { opensPr, sinceLastPr } from '../../src/shared/changesCore'

const edit = (id: string) => ({ kind: 'tool', id, name: 'Write', input: { file_path: `C:/r/${id}.ts` }, status: 'done' })
const shell = (id: string, command: string, status = 'done') => ({ kind: 'tool', id, name: 'Bash', input: { command }, status })
const ids = (items: { id: string }[]) => items.map((i) => i.id)

test('a pull request clears the edits before it; a failed or running one does not', () => {
  assert.ok(opensPr('Bash', { command: 'gh pr create --title x --body y' }))
  assert.ok(opensPr('PowerShell', { command: 'sh ~/.claude/bin/personal-gh.sh pr create --fill' }))
  assert.ok(!opensPr('Bash', { command: 'gh pr view 12' }))
  assert.ok(!opensPr('Read', { command: 'gh pr create' }))
  assert.ok(!opensPr('Bash', null))
  assert.deepEqual(ids(sinceLastPr([edit('a'), edit('b')])), ['a', 'b'])
  assert.deepEqual(ids(sinceLastPr([edit('a'), shell('p1', 'gh pr create --fill'), edit('b'), shell('p2', 'gh pr create'), edit('c')])), ['c'])
  assert.deepEqual(ids(sinceLastPr([edit('a'), shell('p', 'gh pr create --fill', 'error')])), ['a', 'p'])
  assert.deepEqual(ids(sinceLastPr([edit('a'), shell('p', 'gh pr create --fill', 'running')])), ['a', 'p'])
})
