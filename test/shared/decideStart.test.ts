import { describe, expect, it } from 'vitest'
import { decideStart, type Owner } from '../../src/shared/devCore'

const user: Owner = { kind: 'user' }
const thread: Owner = { kind: 'thread', id: 't1', title: 'HelixPrevent insurer dashboard' }
const base = { running: true, runningDir: 'C:/wt/prevent-api-feat', owner: thread, wantDir: 'C:/repos/prevent-api', caller: user }

describe('decideStart', () => {
  it('lets the user restart a thread service onto another folder', () => {
    expect(decideStart(base).act).toBe('restart')
  })

  it('with keepRunning (Stacks Start) leaves a service that came up meanwhile as it is', () => {
    expect(decideStart({ ...base, keepRunning: true })).toEqual({ act: 'reuse', msg: 'already running (started by HelixPrevent insurer dashboard); left as it is' })
  })

  it('starts a stopped service either way', () => {
    expect(decideStart({ ...base, running: false, keepRunning: true }).act).toBe('start')
  })
})
