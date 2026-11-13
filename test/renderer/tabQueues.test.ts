import { beforeAll, describe, expect, it, vi } from 'vitest'

// SessionView is a view: loading it touches window, document and the preload api, so they are stubbed for the one pure rule
let tabQueues: typeof import('../../src/renderer/src/SessionView').tabQueues
let sendsWaiting: typeof import('../../src/renderer/src/SessionView').sendsWaiting
let unreadSteer: typeof import('../../src/renderer/src/SessionView').unreadSteer
beforeAll(async () => {
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) }) // a call that never answers
  const any: any = new Proxy(function () {}, { get: (_t, k) => (k === 'api' ? api : k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : any), apply: () => any })
  vi.stubGlobal('window', any)
  vi.stubGlobal('document', any)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  ;({ tabQueues, sendsWaiting, unreadSteer } = await import('../../src/renderer/src/SessionView'))
})

const tab = { key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false }

describe('tabQueues', () => {
  it('queues the draft while Claude works', () => {
    expect(tabQueues(tab, true, true)).toBe(true)
  })
  it('does nothing in an idle thread, where a queued message would be an ordinary send', () => {
    expect(tabQueues(tab, false, true)).toBe(false)
  })
  it('leaves Tab alone with an empty box, with a modifier, and for other keys', () => {
    expect(tabQueues(tab, true, false)).toBe(false)
    expect(tabQueues({ ...tab, shiftKey: true }, true, true)).toBe(false)
    expect(tabQueues({ ...tab, ctrlKey: true }, true, true)).toBe(false)
    expect(tabQueues({ ...tab, key: 'Enter' }, true, true)).toBe(false)
  })
})

describe('sendsWaiting', () => {
  const user = (x: object) => ({ kind: 'user', text: 'hi', images: [], ...x }) as Item
  const queued = user({ queue: { id: 'q1', pending: true } })
  const steered = user({ steer: true, uuid: 'u1' })
  it('applies with an empty box while Claude works and a message is queued, or steered and not read', () => {
    expect(sendsWaiting(true, false, [queued])).toBe(true)
    expect(sendsWaiting(true, false, [steered])).toBe(true)
  })
  it('does not apply with a draft, in an idle thread, or with nothing waiting', () => {
    expect(sendsWaiting(true, true, [queued, steered])).toBe(false)
    expect(sendsWaiting(false, false, [queued, steered])).toBe(false)
    expect(sendsWaiting(true, false, [user({ uuid: 'u0' }), user({ steer: true, uuid: 'u2', seen: true })])).toBe(false)
  })
  it('a steered message waits until Claude reads it; a failed or still queued one is not an unread steer', () => {
    expect(unreadSteer(steered)).toBe(true)
    expect(unreadSteer(user({ steer: true, uuid: 'u1', seen: true }))).toBe(false)
    expect(unreadSteer(user({ steer: true, uuid: 'u1', failed: 'no process' }))).toBe(false)
    expect(unreadSteer(queued)).toBe(false)
    expect(unreadSteer({ kind: 'note', text: 'x' } as Item)).toBe(false)
  })
})
