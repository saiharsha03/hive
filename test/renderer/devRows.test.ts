import { describe, expect, it } from 'vitest'
import { devRows } from '../../src/renderer/src/useDev'
import type { DevService, DevState } from '../../src/shared/devCore'

const svc = (name: string, state: DevService['state'], port: number | null = null, extra: Partial<DevService> = {}) =>
  ({ name, label: name, repo: name, kind: 'process', port, open: false, state, external: false, note: '', owner: '', fromDir: null, fromLabel: 'main checkout', startedAt: 0, ...extra }) as DevService

const state = (services: DevService[]): DevState => ({
  configured: true, message: '', docker: { phase: 'ready', message: '' },
  stacks: [
    { id: 'prevent', label: 'HelixPrevent stack', services: ['helix_api', 'prevent_api', 'prevent_web'] },
    { id: 'cmms', label: 'HelixCMMS stack', services: ['helix_api', 'helix_web'] },
  ],
  services,
})

describe('devRows', () => {
  it('groups running services into one row per stack, shared ones to the busier stack', () => {
    const rows = devRows(state([svc('helix_api', 'running', 8081), svc('prevent_api', 'running', 8082), svc('prevent_web', 'starting', 3000)]))
    expect(rows).toEqual([{ id: 'dev:helix_api,prevent_api,prevent_web', kind: 'dev', title: 'HelixPrevent stack', state: 'working', note: 'starting 2/3 up, helix_api :8081, prevent_api :8082, prevent_web :3000', since: 0 }])
  })

  it('shows a stack as waiting when one of its services failed', () => {
    const rows = devRows(state([svc('helix_api', 'running', 8081), svc('helix_web', 'failed', null, { note: 'exit 1', startedAt: 5 })]))
    expect(rows).toEqual([{ id: 'dev:helix_api,helix_web', kind: 'dev', title: 'HelixCMMS stack', state: 'waiting', note: 'failed: helix_web exit 1', since: 5 }])
  })

  it('skips stopped and external services', () => {
    expect(devRows(state([svc('helix_api', 'stopped'), svc('prevent_api', 'running', 8082, { external: true })]))).toEqual([])
  })
})
