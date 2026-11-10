// a language server with no open file stops after a while; opening a file meanwhile keeps it
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { idleStop } from '../../src/main/lsp'

afterEach(() => { vi.useRealTimers() })

test('armed with nothing open: stops after the idle time; disarmed by an open file; re-armed when the last one closes', () => {
  vi.useFakeTimers()
  let stopped = 0
  const t = idleStop(() => 10 * 60_000, () => { stopped++ })
  t.arm() // started with no file open
  vi.advanceTimersByTime(9 * 60_000)
  t.disarm() // a file opened
  vi.advanceTimersByTime(60 * 60_000)
  assert.equal(stopped, 0)
  t.arm() // the last file closed
  vi.advanceTimersByTime(5 * 60_000)
  t.arm() // closed again (another file): the wait starts over
  vi.advanceTimersByTime(9 * 60_000)
  assert.equal(stopped, 0)
  vi.advanceTimersByTime(60_000)
  assert.equal(stopped, 1)
})
