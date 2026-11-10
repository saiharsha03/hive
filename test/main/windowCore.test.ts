// the main window's keys, its ready gate and the phone's folder check
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { keyAction, phoneFolder, readyGate } from '../../src/main/windowCore'

const k = (key: string, mods: { control?: boolean; shift?: boolean } = {}, type = 'keyDown') => ({ type, key, control: !!mods.control, shift: !!mods.shift })

test('Ctrl+R and F5 reload only in development; dev tools and Quit always', () => {
  assert.equal(keyAction(k('r', { control: true }), false), null) // the built app: typing Ctrl+R in the terminal reloads nothing
  assert.equal(keyAction(k('F5'), false), null)
  assert.equal(keyAction(k('r', { control: true }), true), 'reload')
  assert.equal(keyAction(k('F5'), true), 'reload')
  assert.equal(keyAction(k('R', { control: true, shift: true }), true), null)
  assert.equal(keyAction(k('I', { control: true, shift: true }), false), 'devtools')
  assert.equal(keyAction(k('q', { control: true }), false), 'quit')
  assert.equal(keyAction(k('q', { control: true, shift: true }), false), null)
  assert.equal(keyAction(k('q', { control: true }, 'keyUp'), false), null)
  assert.equal(keyAction(k('r'), true), null)
})

test('the page is ready for threads only after its reset, and not again until the next one', () => {
  const g = readyGate()
  assert.equal(g.ready(), false) // loaded but not reset yet: a thread started now would be killed by the reset
  g.reset()
  assert.equal(g.ready(), true)
  g.loading() // reload or crash
  assert.equal(g.ready(), false)
  g.reset()
  assert.equal(g.ready(), true)
})

test('a phone starts a thread only in a folder it was offered', () => {
  const offered = ['C:\\ws', 'C:\\ws\\app', 'C:\\ws\\api']
  assert.equal(phoneFolder('C:\\ws\\app', offered, true), 'C:\\ws\\app')
  assert.equal(phoneFolder('c:\\WS\\app\\', offered, true), 'C:\\ws\\app') // the app's own spelling comes back
  assert.equal(phoneFolder('C:\\ws\\app\\..\\..\\Windows', offered, true), null)
  assert.equal(phoneFolder('C:\\Users\\me\\.ssh', offered, true), null)
  assert.equal(phoneFolder('/srv/ws/App', ['/srv/ws/app'], false), null) // case matters off Windows
  assert.equal(phoneFolder('/srv/ws/app/', ['/srv/ws/app'], false), '/srv/ws/app')
})
