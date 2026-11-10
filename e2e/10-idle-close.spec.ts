// Idle close, against a really running Claude process: a thread left idle past the limit has its process closed by
// Hive, the tab stays, and the next message resumes the same Claude session (it still knows what it said). The limit
// is Settings > General's idleCloseMinutes; this run gives it in milliseconds (HIVE_TEST_IDLE_CLOSE_MS, test mode
// only), so the app's own timer fires within seconds. Two tiny turns on Haiku at low effort.
import { expect, test } from '@playwright/test'
import { threadPids, close, launch, liveFacts, selectedTab, shot } from './harness'
import { Hive } from './hive'

test('an idle thread closes its Claude process, keeps its tab, and the next message resumes the same session', async () => {
  const l = await launch({ env: { HIVE_TEST_IDLE_CLOSE_MS: '8000' } })
  try {
    const h = new Hive(l.page)
    await h.newSession()
    const tab = await selectedTab(l.page)
    const tabs = await h.id('tab').count()
    expect((await h.sendAndWait('Reply with the single word pear')).toLowerCase()).toContain('pear')

    // the process is there: main has it, and so has the operating system
    const before = await liveFacts(l, tab)
    const pids = threadPids(l)
    expect(before?.sessionId).toBeTruthy()
    expect(pids).toHaveLength(1)

    // idle past the limit: main lets go of the process and the operating system no longer lists it
    await expect.poll(() => liveFacts(l, tab), { timeout: 60_000 }).toBeNull()
    await expect.poll(() => threadPids(l).filter((p) => pids.includes(p)), { timeout: 30_000 }).toEqual([])
    // the tab is still there, still the open one, with its conversation and no error row
    await expect(h.id('tab')).toHaveCount(tabs)
    expect(await selectedTab(l.page)).toBe(tab)
    await expect(h.composer()).toBeVisible()
    await expect(h.replies().last()).toContainText(/pear/i)
    await expect(h.errors()).toHaveCount(0)
    await shot(l.page, 'idle-closed')

    // the next message starts a new process on the same session: Claude still knows its own last reply
    expect((await h.sendAndWait('What single word did you just reply with?')).toLowerCase()).toContain('pear')
    const after = await liveFacts(l, tab)
    expect(after?.sessionId).toBe(before!.sessionId)
    const again = threadPids(l)
    expect(again).toHaveLength(1)
    expect(again[0]).not.toBe(pids[0])
    await expect(h.errors()).toHaveCount(0)
  } finally {
    await close(l)
  }
})
