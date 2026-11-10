// threads waiting for a usage limit: saved to a real temp HIVE_DATA_DIR, fired by fake timers
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'hive-continue-'))
const file = join(process.env.HIVE_DATA_DIR, 'hive-autocontinue.json')
const ac = await import('../../src/main/autoContinue')
const { CONTINUE_PROMPT } = await import('../../src/shared/continueCore')

describe('autoContinue', () => {
  afterEach(() => { vi.useRealTimers() })
  test('fires a minute after the reset, staggers a second thread, saves to disk, cancels', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 4, 13, 0) })
    writeFileSync(file, '[]')
    const fired: string[] = []
    const changes: [string, number | null][] = []
    ac.initAutoContinue({ fire: async (w, prompt) => { fired.push(`${w.key}:${prompt}`); return true }, changed: (w, at) => changes.push([w.key, at]) })
    const reset = Date.now() + 3_600_000
    const a = ac.scheduleContinue({ key: 's1', tabId: 't1', cwd: 'c', title: 'One' }, reset)
    const b = ac.scheduleContinue({ key: 's2', tabId: 't2', cwd: 'c', title: 'Two' }, reset)
    expect(a.at).toBe(reset + 60_000)
    expect(b.at).toBe(reset + 60_000 + 180_000)
    expect(JSON.parse(readFileSync(file, 'utf8')).map((w: any) => w.key)).toEqual(['s1', 's2'])
    expect(ac.continueAt('t2')).toBe(b.at)
    await vi.advanceTimersByTimeAsync(3_600_000 + 61_000)
    expect(fired).toEqual([`s1:${CONTINUE_PROMPT}`])
    expect(ac.cancelContinue('s2')).toBe(true)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(fired).toHaveLength(1)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([])
    expect(changes.map(([k, at]) => [k, at === null])).toEqual([['s1', false], ['s2', false], ['s1', true], ['s2', true]])
  })

  test('a restart keeps the wakes; one that came due while closed goes out after start; no window = retried', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 4, 13, 0) })
    const now = Date.now()
    writeFileSync(file, JSON.stringify([{ key: 'old', tabId: 'x', cwd: 'c', title: 'Old', at: now - 3_600_000 }, { key: 'bad' }]))
    let windowOpen = false
    const fired: string[] = []
    ac.initAutoContinue({ fire: async (w) => { if (!windowOpen) return false; fired.push(w.key); return true }, changed: () => {} })
    expect(ac.continueAt('old')).toBe(now + 60_000)
    expect(ac.continueAt('bad')).toBeNull()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(fired).toEqual([]) // no window yet
    windowOpen = true
    await vi.advanceTimersByTimeAsync(61_000)
    expect(fired).toEqual(['old'])
  })
})
