import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  blurred, dismissed, emptySeen, looksSecret, offered, shouldOffer, textLabel, BIG_TEXT, PREVIEW_CHARS,
} from '../../src/shared/clipboardCore'

// built at runtime from fragments so no credential-shaped literal sits in a file
const rand = (n: number, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => {
  let s = '', x = 12345
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) % 2147483648; s += chars[(x >> 8) % chars.length] }
  return s
}
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

test('known credential shapes are skipped', () => {
  for (const t of [
    'sk' + '-' + rand(40),
    'sk' + '-ant-api03-' + rand(40),
    'here: ' + 'gh' + 'p_' + rand(36),
    'github' + '_pat_' + rand(30),
    'xo' + 'xb-' + rand(24),
    'AK' + 'IA' + rand(16, UPPER),
    'ey' + 'J' + rand(20) + '.' + rand(30) + '.' + rand(30),
    '-----BEGIN RSA ' + 'PRIV' + 'ATE KEY-----\nabc\n-----END-----',
  ]) assert.equal(looksSecret(t), true, t.slice(0, 6))
})

test('a single line naming a password, token or secret is skipped; multi-line prose is not', () => {
  assert.equal(looksSecret('db pass' + 'word: hunter2'), true)
  assert.equal(looksSecret('TOK' + 'EN=abc'), true)
  assert.equal(looksSecret('client_sec' + 'ret abc'), true)
  assert.equal(looksSecret('Rotate the tok' + 'en weekly.\nThen restart the worker.'), false)
})

test('long high-entropy tokens are skipped', () => {
  assert.equal(looksSecret(rand(40)), true)
  assert.equal(looksSecret('export KEY=' + rand(48)), true)
  assert.equal(looksSecret('first line\nvalue ' + rand(40) + '\nlast'), true)
})

test('ordinary text is offered', () => {
  for (const t of [
    'Please fix the failing test in the tabs panel',
    'const x = items.filter((i) => i.kind === "tool").length',
    '13f03b0b2c4e5f60718293a4b5c6d7e8f9012345', // 40-char hex commit sha
    'c3d1a8e2-4f6b-4a9e-8c7d-2b1f0e9a6d54', // uuid
    'https://github.com/example/repo/pull/19/files',
    'C:\\Users\\someone\\Desktop\\project\\src\\renderer\\src\\SessionView.tsx',
    'thisIsAVeryLongCamelCaseIdentifierNameWithoutDigits',
    'skip-this-step-for-now and continue',
    '',
  ]) assert.equal(looksSecret(t), false, t)
})

test('textLabel: one line, cut at the preview length, size only when very long', () => {
  assert.deepEqual(textLabel('  a\n\tb  '), { preview: 'a b', big: false })
  const l = textLabel('x'.repeat(200))
  assert.equal(l.big, false)
  assert.equal(l.preview, 'x'.repeat(PREVIEW_CHARS) + '…')
  assert.deepEqual(textLabel('y'.repeat(BIG_TEXT + 1)), { preview: '', big: true })
  assert.equal(textLabel('y'.repeat(BIG_TEXT)).big, false)
})

test('new only: an item is offered once', () => {
  let s = emptySeen()
  assert.equal(shouldOffer(s, null), false)
  assert.equal(shouldOffer(s, 't:a'), true)
  s = offered(s, 't:a')
  assert.equal(shouldOffer(s, 't:a'), false)
  assert.equal(shouldOffer(s, 'i:b'), true)
})

test('what the clipboard held when Orbit lost focus is not offered back (copied inside Orbit)', () => {
  let s = offered(emptySeen(), 't:a')
  s = blurred(s, 't:mine')
  assert.equal(shouldOffer(s, 't:mine'), false)
  assert.equal(shouldOffer(s, 't:other'), true)
  s = blurred(s, null)
  assert.equal(shouldOffer(s, 't:mine'), true)
})

test('a dismissed item is never offered again, even after other offers', () => {
  let s = offered(emptySeen(), 't:a')
  s = dismissed(s, 't:a')
  s = offered(s, 't:b')
  assert.equal(shouldOffer(s, 't:a'), false)
  assert.equal(dismissed(s, 't:a').dismissed.length, 1)
})

test('the dismissed list stays bounded', () => {
  let s = emptySeen()
  for (let i = 0; i < 500; i++) s = dismissed(s, `t:${i}`)
  assert.equal(s.dismissed.length, 200)
  assert.equal(shouldOffer(s, 't:499'), false)
})
