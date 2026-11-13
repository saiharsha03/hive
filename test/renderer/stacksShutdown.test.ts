import { describe, expect, it } from 'vitest'
import { shutdownNames, startNames } from '../../src/renderer/src/DevPanel'
import type { DevService, StackDef } from '../../src/shared/devCore'

const svc = (name: string, state: DevService['state'], external = false) =>
  ({ name, label: name, repo: name, kind: 'process', port: null, open: false, state, external, note: '', owner: '', fromDir: null, fromLabel: '', startedAt: 0 }) as DevService
const shop: StackDef = { id: 'shop', label: 'Shop stack', services: ['db', 'core_api', 'shop_api', 'shop_web'] }
const admin: StackDef = { id: 'admin', label: 'Admin stack', services: ['db', 'core_api', 'admin_web'] }

describe('shutdownNames', () => {
  it('stops every live service of the stack when no other stack runs', () => {
    const live = [svc('db', 'running'), svc('core_api', 'running'), svc('shop_api', 'starting'), svc('shop_web', 'stopped'), svc('admin_web', 'stopped')]
    expect(shutdownNames(shop, [shop, admin], live)).toEqual(['db', 'core_api', 'shop_api'])
  })

  it('keeps shared services another running stack still uses, and skips ones run outside Orbit', () => {
    const live = [svc('db', 'running'), svc('core_api', 'running'), svc('shop_api', 'running'), svc('shop_web', 'running', true), svc('admin_web', 'running')]
    expect(shutdownNames(shop, [shop, admin], live)).toEqual(['shop_api'])
  })
})

describe('shutdownNames with a stack run outside Orbit', () => {
  it('keeps shared services when the other stack runs only outside Orbit', () => {
    const live = [svc('db', 'running'), svc('core_api', 'running'), svc('shop_api', 'running'), svc('shop_web', 'stopped'), svc('admin_web', 'running', true)]
    expect(shutdownNames(shop, [shop, admin], live)).toEqual(['shop_api'])
  })
})

describe('startNames', () => {
  it('starts only what is not running, so running services keep their folder', () => {
    const live = [svc('db', 'running'), svc('core_api', 'failed'), svc('shop_api', 'starting'), svc('shop_web', 'stopped')]
    expect(startNames(shop, live)).toEqual(['core_api', 'shop_web'])
  })
})
