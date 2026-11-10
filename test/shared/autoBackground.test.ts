// a shell command still running after the limit is moved to the background; finished ones and agents are not
import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { autoBackground } from '../../src/shared/autoBackgroundCore'

test('only shell commands still running at the limit go to the background', async () => {
  vi.useFakeTimers()
  const moved: string[] = []
  const a = autoBackground(async (id) => { moved.push(id) }, 60_000)
  a.started([
    { type: 'tool_use', id: 'long', name: 'Bash', input: { command: 'npm test' } },
    { type: 'tool_use', id: 'quick', name: 'PowerShell', input: { command: 'ls' } },
    { type: 'tool_use', id: 'agent', name: 'Agent', input: {} },
    { type: 'tool_use', id: 'bg', name: 'Bash', input: { command: 'x', run_in_background: true } },
  ])
  a.ended([{ type: 'tool_result', tool_use_id: 'quick' }])
  vi.advanceTimersByTime(59_000)
  assert.equal(moved.join(), '')
  vi.advanceTimersByTime(1_000)
  assert.equal(moved.join(), 'long')
  a.started([{ type: 'tool_use', id: 'next', name: 'Bash', input: {} }])
  a.clear() // the turn ended
  vi.advanceTimersByTime(120_000)
  assert.equal(moved.join(), 'long')
  const off = autoBackground(async (id: string) => { moved.push(id) }, 0)
  off.started([{ type: 'tool_use', id: 'z', name: 'Bash', input: {} }])
  assert.equal(off.pending(), 0)
  vi.useRealTimers()
})
