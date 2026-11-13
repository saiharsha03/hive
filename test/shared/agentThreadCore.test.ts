import { test } from 'vitest'
import assert from 'node:assert/strict'
import { IDLE_MS, agentLabel, hasBell, lastLine, looksLikePrompt, nextState, parseAgents, stripAnsi } from '../../src/shared/agentThreadCore'

test('parseAgents keeps entries with a name and a command, trimmed; args default to none', () => {
  assert.deepEqual(parseAgents([
    { name: ' codex ', command: ' codex ', args: [' --full-auto ', ''] },
    { name: 'oc', command: 'opencode' },
    { name: 'gem', command: 'gemini', args: ' -m  pro ' },
    { name: '', command: 'x' }, { name: 'no command', command: '  ' }, null, 'codex', { name: 'bad args', command: 'y', args: [1, 'a'] },
  ]), [
    { name: 'codex', command: 'codex', args: ['--full-auto'] },
    { name: 'oc', command: 'opencode', args: [] },
    { name: 'gem', command: 'gemini', args: ['-m', 'pro'] },
    { name: 'bad args', command: 'y', args: ['a'] },
  ])
  assert.deepEqual(parseAgents(undefined), [])
  assert.deepEqual(parseAgents({ name: 'x', command: 'y' }), [])
})

test('stripAnsi and lastLine read the screen text: colours gone, a carriage return overwrites, blank lines skipped', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red')
  assert.equal(lastLine('first\nworking...\rDone >  \n\n  \n'), 'Done >')
  assert.equal(lastLine('\x1b]0;title\x07ready'), 'ready')
  assert.equal(lastLine(''), '')
})

test('looksLikePrompt: a prompt character or a yes/no question at the end of the last line', () => {
  for (const t of ['output\n> ', '\x1b[32m❯\x1b[0m ', '› ', 'Continue?', 'Password:', 'Apply this patch (y/n)', 'Overwrite [Y/n] now']) assert.equal(looksLikePrompt(t), true, t)
  for (const t of ['Compiling 3 files', 'done.\n', '', 'line one?\nstill working']) assert.equal(looksLikePrompt(t), false, t)
})

test('hasBell: a bare BEL rings; the BEL that ends a title sequence does not', () => {
  assert.equal(hasBell('done\x07'), true)
  assert.equal(hasBell('\x1b]0;codex\x07working'), false)
  assert.equal(hasBell('\x1b]0;codex\x07\x07'), true)
})

test('nextState: output runs, a bell waits, a quiet prompt waits, exit ends', () => {
  assert.equal(nextState('waiting', { type: 'output', tail: 'x' }), 'running')
  assert.equal(nextState('running', { type: 'bell' }), 'waiting')
  assert.equal(nextState('running', { type: 'idle', ms: IDLE_MS, tail: 'ok?\n> ' }), 'waiting')
  assert.equal(nextState('running', { type: 'idle', ms: IDLE_MS - 1, tail: '> ' }), 'running') // not quiet long enough
  assert.equal(nextState('running', { type: 'idle', ms: 60_000, tail: 'compiling' }), 'running') // quiet, but no prompt
  assert.equal(nextState('running', { type: 'exit', code: 0 }), 'exited')
  assert.equal(nextState('waiting', { type: 'exit', code: 1 }), 'failed')
})

test('nextState: exited and failed stay until a restart', () => {
  for (const prev of ['exited', 'failed'] as const) {
    assert.equal(nextState(prev, { type: 'output', tail: 'x' }), prev)
    assert.equal(nextState(prev, { type: 'bell' }), prev)
    assert.equal(nextState(prev, { type: 'idle', ms: 10_000, tail: '> ' }), prev)
    assert.equal(nextState(prev, { type: 'exit', code: 0 }), prev)
  }
})

test('agentLabel: the waiting guess carries a question mark', () => {
  assert.deepEqual((['running', 'waiting', 'exited', 'failed'] as const).map(agentLabel), ['running', 'needs you?', 'exited', 'failed'])
})
