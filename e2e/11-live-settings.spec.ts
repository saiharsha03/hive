// The advisor model and the Workflows switch, read back from a really running Claude process. Orbit passes both in the
// flag-settings layer at start (options.settings) and a thread's own advisor pick later through applyFlagSettings;
// the process itself says what it has when asked for its settings (the get_settings control request): the merged
// settings, each source's own, and what it applies (the advisor as the model id it resolved to).
// Test mode passes neither by itself, so this run names them (HIVE_TEST_ADVISOR, HIVE_TEST_WORKFLOWS, test mode only).
// One tiny turn on Haiku at low effort, which is what starts the process; nothing here calls the advisor.
import { expect, test } from '@playwright/test'
import { close, launch, liveSettings, selectedTab, shot, type Launched, type LiveSettings } from './harness'
import { Orbit } from './hive'

const flag = (s: LiveSettings | null): Record<string, unknown> => s?.sources.find((x) => x.source === 'flagSettings')?.settings ?? {}
// what the process holds for the two settings: Orbit's flag layer, the merged result, and the advisor it applies
const held = async (l: Launched, tab: string) => {
  const s = await liveSettings(l, tab)
  return { flagAdvisor: flag(s).advisorModel ?? null, flagWorkflows: flag(s).enableWorkflows ?? null, advisor: s?.effective.advisorModel ?? null, workflows: s?.effective.enableWorkflows ?? null, applied: String(s?.applied?.advisor ?? '') }
}

test('the advisor model and Workflows reach the Claude process, and a thread\'s advisor pick changes it live', async () => {
  const l = await launch({ env: { HIVE_TEST_ADVISOR: 'opus', HIVE_TEST_WORKFLOWS: 'on' } })
  try {
    const h = new Orbit(l.page)
    await h.newSession()
    const tab = await selectedTab(l.page)
    expect(await liveSettings(l, tab)).toBeNull() // no process before the first message
    expect((await h.sendAndWait('Reply with the single word ok')).toLowerCase()).toContain('ok')

    // at start: both are in the flag layer the process reports, win the merge, and the advisor resolves to an Opus model
    const start = await held(l, tab)
    expect(start).toMatchObject({ flagAdvisor: 'opus', flagWorkflows: true, advisor: 'opus', workflows: true })
    expect(start.applied).toMatch(/opus/i)

    // the thread picks another advisor in the model menu: the same process now has that one
    await h.modelPicker().click()
    const row = h.id('model-list').locator('[data-testid^="model-list-advisor:"]').filter({ hasText: /sonnet/i }).first()
    await expect(row).toBeVisible({ timeout: 60_000 })
    const pick = (await row.getAttribute('data-testid'))!.replace('model-list-advisor:', '')
    await row.click()
    await expect(h.id('advisor-word')).toHaveText(/^advisor .*sonnet/i)
    await expect.poll(async () => (await held(l, tab)).flagAdvisor).toBe(pick)
    const picked = await held(l, tab)
    expect(picked).toMatchObject({ advisor: pick, flagWorkflows: true, workflows: true }) // Workflows untouched
    expect(picked.applied).toMatch(/sonnet/i)
    expect(picked.applied).not.toBe(start.applied)
    await shot(l.page, 'live-settings-advisor')

    // Off: the process runs no advisor. It started with one, which clearing the flag would bring back (the bug this
    // spec found), so Orbit sends an empty advisor: nothing is applied, and it is not the one from the start
    await h.modelPicker().click()
    await h.id('model-list').getByTestId('model-list-advisor-off').click()
    await expect(h.id('advisor-word')).toHaveCount(0)
    await expect.poll(async () => (await held(l, tab)).applied).toBe('')
    expect(await held(l, tab)).toMatchObject({ flagAdvisor: '', advisor: '' })
    expect((await held(l, tab)).flagWorkflows).toBe(true)
    await expect(h.errors()).toHaveCount(0)
  } finally {
    await close(l)
  }
})
