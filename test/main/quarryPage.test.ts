// the Quarry page's theme: Quarry's own name when Hive's matches, else light, high contrast or Quarry's dark graphite
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { quarryTheme } from '../../src/renderer/src/pages/quarryCore'

test('Hive theme to Quarry theme', () => {
  assert.equal(quarryTheme('midnight'), 'midnight')
  assert.equal(quarryTheme('Paper'), 'paper')
  assert.equal(quarryTheme('light-warm'), 'light')
  assert.equal(quarryTheme('hc-contrast'), 'high-contrast')
  assert.equal(quarryTheme('dark'), 'quiet') // Hive's id for the theme it shows as Quiet
  assert.equal(quarryTheme('hc'), 'high-contrast')
  assert.equal(quarryTheme('graphite'), 'graphite')
  assert.equal(quarryTheme('somethingelse'), 'graphite')
  assert.equal(quarryTheme(undefined), 'graphite')
})
