import { test } from 'vitest'
import assert from 'node:assert/strict'
import { conversationMarkdown } from '../../src/shared/exportCore'

test('a conversation becomes Markdown in order, tool calls as one list', () => {
  const md = conversationMarkdown('My chat', [
    { kind: 'user', text: 'Fix it', images: ['a.png'] },
    { kind: 'tool', name: 'Bash', input: 'ls' },
    { kind: 'tool', name: 'Read', input: 'x' },
    { kind: 'assistant', text: 'Done' },
    { kind: 'note', text: 'Model changed: Opus 5.5 → Fable 5.2' },
    { kind: 'error', text: 'boom' },
  ], (n, i) => `${n}: ${i}`)
  assert.equal(md, '# My chat\n\n## You\n\nFix it\n\n[image]\n\n- Bash: ls\n- Read: x\n\n## Claude\n\nDone\n\n_Model changed: Opus 5.5 → Fable 5.2_\n\n**Error:** boom\n')
})

test('a partial export says where it starts', () => {
  assert.match(conversationMarkdown('T', [], () => '', true), /starts at the loaded part/)
})
