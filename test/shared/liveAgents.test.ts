// a thread whose turn ended but whose subagents still run is listed as working, waiting on them
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { liveRows } from '../../src/renderer/src/background'
import type { Session } from '../../src/renderer/src/chat'

const s = (id: string, over: Partial<Session> = {}): Session => ({ id, title: id, items: [], streaming: '', busy: false, loaded: true, background: false, ...over })

test('idle or finished threads with running agents are working; a question still waits; no agents, no row', () => {
  const all = [
    s('idle'),
    s('finished', { waitingReason: 'Finished: done', waitingSince: 1 }),
    s('asks', { waitingReason: 'Which account?', waitingSince: 2 }),
    s('quiet'),
  ]
  const r = liveRows(all, [], new Map([['idle', 2], ['finished', 1], ['asks', 1]]))
  assert.deepEqual(r.working.map((x) => [x.id, x.note]), [['idle', 'Waiting on 2 agents'], ['finished', 'Waiting on 1 agent']])
  assert.deepEqual(r.waiting.map((x) => x.id), ['asks'])
})
