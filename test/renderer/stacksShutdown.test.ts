import { describe, expect, it } from 'vitest'
import { shutdownNames, startNames } from '../../src/renderer/src/DevPanel'
import type { DevService, StackDef } from '../../src/shared/devCore'

const svc = (name: string, state: DevService['state'], external = false) =>
  ({ name, label: name, repo: name, kind: 'process', port: null, open: false, state, external, note: '', owner: '', fromDir: null, fromLabel: '', startedAt: 0 }) as DevService
const prevent: StackDef = { id: 'prevent', label: 'HelixPrevent stack', services: ['helix_db', 'helix_api', 'prevent_api', 'prevent_web'] }
const cmms: StackDef = { id: 'cmms', label: 'HelixCMMS stack', services: ['helix_db', 'helix_api', 'helix_web'] }

describe('shutdownNames', () => {
  it('stops every live service of the stack when no other stack runs', () => {
    const live = [svc('helix_db', 'running'), svc('helix_api', 'running'), svc('prevent_api', 'starting'), svc('prevent_web', 'stopped'), svc('helix_web', 'stopped')]
    expect(shutdownNames(prevent, [prevent, cmms], live)).toEqual(['helix_db', 'helix_api', 'prevent_api'])
  })

  it('keeps shared services another running stack still uses, and skips ones run outside Hive', () => {
    const live = [svc('helix_db', 'running'), svc('helix_api', 'running'), svc('prevent_api', 'running'), svc('prevent_web', 'running', true), svc('helix_web', 'running')]
    expect(shutdownNames(prevent, [prevent, cmms], live)).toEqual(['prevent_api'])
  })
})

describe('shutdownNames with a stack run outside Hive', () => {
  it('keeps shared services when the other stack runs only outside Hive', () => {
    const live = [svc('helix_db', 'running'), svc('helix_api', 'running'), svc('prevent_api', 'running'), svc('prevent_web', 'stopped'), svc('helix_web', 'running', true)]
    expect(shutdownNames(prevent, [prevent, cmms], live)).toEqual(['prevent_api'])
  })
})

describe('startNames', () => {
  it('starts only what is not running, so running services keep their folder', () => {
    const live = [svc('helix_db', 'running'), svc('helix_api', 'failed'), svc('prevent_api', 'starting'), svc('prevent_web', 'stopped')]
    expect(startNames(prevent, live)).toEqual(['helix_api', 'prevent_web'])
  })
})
