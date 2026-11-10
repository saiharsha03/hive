import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hookWarning, isContinuation, summaryBody } from '../../src/shared/summaryCore'
import { loadHistory } from '../../src/main/history'

test('summary: compaction summary detection', () => {
  const text = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n<system-reminder>\n<tools-used-before-summary>Bash</tools-used-before-summary>\n</system-reminder>\nSummary:\n1. Intent'
  assert.ok(isContinuation(text))
  assert.ok(isContinuation('  ' + text))
  assert.ok(!isContinuation('Please say: This session is being continued from a previous conversation'))
  assert.equal(summaryBody(text), 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Intent')
})
test('summary: history renders the summary as one collapsed item, not a "You" message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-hist-'))
  const file = join(dir, 's.jsonl')
  const summary = 'This session is being continued from a previous conversation that ran out of context.\nSummary: did things'
  writeFileSync(file, [
    { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' } },
    { type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: summary } },
    { type: 'user', message: { role: 'user', content: 'next question' } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: summary }] } },
  ].map((o) => JSON.stringify(o)).join('\n'))
  const items = await loadHistory(file)
  assert.deepEqual(items.map((i) => i.kind), ['note', 'summary', 'user', 'summary'])
  assert.equal((items[1] as any).text, summary)
})
test('hooks: only words meant for the user become a warning row', () => {
  const base = { type: 'system', subtype: 'hook_response', hook_id: 'h', stdout: '', stderr: '', exit_code: 0, outcome: 'success' }
  assert.equal(hookWarning({ ...base, hook_event: 'SessionStart', hook_name: 'SessionStart:startup', output: '{"systemMessage":"hi"}' }), null)
  assert.equal(hookWarning({ ...base, hook_event: 'PostToolUse', hook_name: 'PostToolUse:Write', output: '' }), null)
  assert.equal(hookWarning({ ...base, hook_event: 'PostToolUse', hook_name: 'PostToolUse:Write', output: '{"async": true, "asyncTimeout": 180000}\r\n{"metrics": {"pattern_hits": 0}}' }), null)
  const sg = hookWarning({ ...base, hook_event: 'PostToolUse', hook_name: 'PostToolUse:Write', output: JSON.stringify({ metrics: { pattern_hits: 1 }, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: '[from security-guidance@claude-code-plugins plugin]\n\nsubprocess with shell=True is risky' } }) })
  assert.deepEqual(sg, { event: 'PostToolUse', name: 'PostToolUse:Write', text: '[from security-guidance@claude-code-plugins plugin]\n\nsubprocess with shell=True is risky' })
  // additionalContext from a prompt hook is Claude's context, not a warning; systemMessage always shows
  assert.equal(hookWarning({ ...base, hook_event: 'UserPromptSubmit', hook_name: 'UserPromptSubmit', output: '{"hookSpecificOutput":{"additionalContext":"skill hint"}}' }), null)
  assert.equal(hookWarning({ ...base, hook_event: 'Stop', hook_name: 'Stop', output: '{"systemMessage":"review queued"}' })!.text, 'review queued')
  // a block: exit 2 with stderr
  assert.equal(hookWarning({ ...base, hook_event: 'PreToolUse', hook_name: 'PreToolUse:Bash', exit_code: 2, outcome: 'error', stderr: 'push blocked: review first\n' })!.text, 'push blocked: review first')
  assert.equal(hookWarning({ ...base, hook_event: 'PreToolUse', hook_name: 'x', output: '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"nope"}}' })!.text, 'nope')
  assert.equal(hookWarning({ type: 'system', subtype: 'hook_started', hook_event: 'PostToolUse' }), null)
})
