import { test } from 'vitest'
import assert from 'node:assert/strict'
import { resultText } from '../../src/shared/toolOutputCore'

test('a string result is kept as is; a block list keeps its text and notes images', () => {
  assert.equal(resultText('exit 1\nboom'), 'exit 1\nboom')
  assert.equal(resultText([{ type: 'text', text: 'one' }, { type: 'image', source: {} }, { type: 'text', text: 'two' }]), 'one\n[image]\ntwo')
  assert.equal(resultText([{ type: 'tool_reference', tool_name: 'x' }]), '')
  assert.equal(resultText(undefined), '')
})

test('the tool_use_error wrapper is dropped', () => {
  assert.equal(resultText('<tool_use_error>File has not been read yet.</tool_use_error>'), 'File has not been read yet.')
})

test('huge output is cut with a marker', () => {
  const out = resultText('x'.repeat(50), 10)
  assert.equal(out, `${'x'.repeat(10)}\n… output cut (50 chars in all)`)
  assert.equal(resultText('x'.repeat(10), 10), 'x'.repeat(10))
})
