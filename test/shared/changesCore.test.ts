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
  // only an executed gh pr create counts, not a search or echo of the words
  assert.ok(opensPr('Bash', { command: 'cd repo && git push -u origin x && gh pr create --fill' }))
  assert.ok(opensPr('Bash', { command: 'GH_HOST=github.com gh pr create --fill' }))
  assert.ok(opensPr('PowerShell', { command: '& C:/tools/gh.exe pr create --fill' }))
  assert.ok(!opensPr('Bash', { command: "rg 'pr create' src" }))
  assert.ok(!opensPr('Bash', { command: "echo 'gh pr create --fill'" }))
  assert.ok(!opensPr('Bash', { command: 'grep -n "gh pr create" docs/README.md' }))
  // separators inside quotes or a heredoc body never start a command
  assert.ok(!opensPr('Bash', { command: 'echo "example; gh pr create --fill"' }))
  assert.ok(!opensPr('Bash', { command: "printf 'a && gh pr create'" }))
  assert.ok(!opensPr('Bash', { command: "cat > notes.md <<'EOF'\ngh pr create --fill\nEOF" }))
  assert.ok(opensPr('Bash', { command: "gh pr create --title \"fix; tidy\" --body-file - <<'EOF'\nbody\nEOF" }))
  assert.ok(opensPr('PowerShell', { command: '& "C:\\Program Files\\GitHub CLI\\gh.exe" pr create --fill' }))
  assert.ok(opensPr('Bash', { command: 'cd x; gh pr create --fill' }))
  assert.ok(opensPr('Bash', { command: 'url=$(gh pr create --fill) && echo $url' }))
  assert.ok(opensPr('Bash', { command: 'echo `gh pr create --fill`' }))
  assert.deepEqual(ids(sinceLastPr([edit('a'), edit('b')])), ['a', 'b'])
  assert.deepEqual(ids(sinceLastPr([edit('a'), shell('p1', 'gh pr create --fill'), edit('b'), shell('p2', 'gh pr create'), edit('c')])), ['c'])
  assert.deepEqual(ids(sinceLastPr([edit('a'), shell('p', 'gh pr create --fill', 'error')])), ['a', 'p'])
  assert.deepEqual(ids(sinceLastPr([edit('a'), shell('p', 'gh pr create --fill', 'running')])), ['a', 'p'])
})
