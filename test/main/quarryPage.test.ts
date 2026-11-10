// the Quarry page's theme: Quarry's own name when Hive's matches, else light, high contrast or Quarry's dark graphite
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { quarryTheme } from '../../src/renderer/src/pages/quarryCore'

test('Hive theme to Quarry theme', () => {
  assert.equal(quarryTheme('midnight'), 'midnight')
  assert.equal(quarryTheme('Paper'), 'paper')
  assert.equal(quarryTheme('light-warm'), 'light')
  assert.equal(quarryTheme('hc-contrast'), 'high-contrast')
  assert.equal(quarryTheme('dark'), 'graphite')
  assert.equal(quarryTheme(undefined), 'graphite')
})
